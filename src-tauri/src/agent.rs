use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::Emitter;
use tokio::sync::watch;

#[derive(Default)]
pub struct AgentState { active: Mutex<HashMap<String, (String, watch::Sender<bool>)>> }
pub fn cancel_all(state: &AgentState) { if let Ok(active)=state.active.lock() {for (_,sender) in active.values(){let _=sender.send(true);}} }

fn credential() -> Result<keyring::Entry, String> {
    keyring::Entry::new("app.bluegay.ide.ChatLGBT", "openai-api-key")
        .map_err(|_| "Could not access Windows Credential Manager.".into())
}
fn api_key() -> Option<String> {
    credential().ok().and_then(|e| e.get_password().ok())
        .or_else(|| std::env::var("OPENAI_API_KEY").ok()).filter(|s| !s.trim().is_empty())
}
#[tauri::command]
pub fn agent_status() -> serde_json::Value { serde_json::json!({"configured":api_key().is_some()}) }

#[tauri::command]
pub fn agent_set_key(key: String) -> Result<(), String> {
    let value=key.trim();
    if value.len()<10 || value.len()>512 || value.chars().any(char::is_whitespace) { return Err("Enter a valid API key.".into()); }
    credential()?.set_password(value).map_err(|_| "Could not save the key in Windows Credential Manager.".into())
}
#[tauri::command]
pub fn agent_delete_key() -> Result<(), String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Could not remove the stored API key.".into()),
    }
}
#[derive(Deserialize, Serialize)]
pub struct Message { role: String, content: String }
#[derive(Deserialize, Serialize)]
pub struct Request {
    model: String, instructions: String, input: Vec<Message>, max_output_tokens: u32,
    #[serde(default, skip_serializing)] auth_provider: String,
    #[serde(default, skip_serializing)] account_id: String,
    #[serde(default, skip_serializing)] purpose: String,
}
impl Request {
    fn wire_body(&self)->Result<serde_json::Value,String>{
        self.validate()?;
        let mut body=serde_json::to_value(self).map_err(|_|"Invalid request.")?;
        body["stream"]=true.into();body["store"]=false.into();
        if self.auth_provider=="chatgpt"{body.as_object_mut().unwrap().remove("max_output_tokens");}
        Ok(body)
    }
    fn validate(&self) -> Result<(), String> {
        if !["", "api", "chatgpt"].contains(&self.auth_provider.as_str()) || self.account_id.len()>200 || !["", "code_prediction"].contains(&self.purpose.as_str()) { return Err("Invalid connection mode.".into()); }
        let limits=if self.purpose=="code_prediction" {64..=2048} else {1000..=16000};
        if self.model.is_empty() || self.model.len()>100 || !self.model.bytes().all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c)) || self.instructions.len()>10000 || self.input.is_empty() || self.input.len()>9 || !limits.contains(&self.max_output_tokens) { return Err("Invalid model request.".into()); }
        if self.input.iter().any(|m| !["user","assistant"].contains(&m.role.as_str())) || serde_json::to_string(&self.input).map_err(|_| "Invalid context.")?.len()>360000 { return Err("Invalid or oversized context.".into()); }
        Ok(())
    }
}
#[tauri::command]
pub fn agent_cancel(id: String, state: tauri::State<AgentState>) -> Result<(), String> {
    let active=state.active.lock().map_err(|_| "Agent state unavailable.")?;
    for (running,sender) in active.values() {if running==&id {let _=sender.send(true);}}
    Ok(())
}
#[derive(Clone, Serialize)]
struct Chunk { id: String, chunk: Vec<u8> }

async fn renewable_credentials<F>(cancel:&watch::Receiver<bool>,renew:F)->Result<String,String>
where F:std::future::Future<Output=Result<String,String>> {
    if *cancel.borrow(){return Err("Request stopped.".into())}
    // Never drop an in-flight rotating-token exchange when a request is stopped.
    // Finish saving the credentials, then honor cancellation before inference.
    let result=renew.await;
    if *cancel.borrow(){return Err("Request stopped.".into())}result
}

#[tauri::command]
pub async fn agent_respond(id: String, payload: Request, window: tauri::WebviewWindow, state: tauri::State<'_, AgentState>, account: tauri::State<'_, crate::chatgpt::ChatGptState>) -> Result<(), String> {
    payload.validate()?;
    if id.len()>80 { return Err("Invalid request id.".into()); }
    let (sender,mut cancel)=watch::channel(false);
    let lane=if payload.purpose=="code_prediction" {"prediction"} else {"chat"};
    {
        let mut active=state.active.lock().map_err(|_| "Agent state unavailable.")?;
        if active.contains_key(lane) { return Err("Another request of this kind is running.".into()); }
        if active.values().any(|(running,_)|running==&id) {return Err("Duplicate request id.".into());}
        active.insert(lane.into(),(id.clone(),sender));
    }
    let result=async {
        let uses_chatgpt=payload.auth_provider=="chatgpt";
        let key=if uses_chatgpt {renewable_credentials(&cancel,crate::chatgpt::access(&account,&payload.account_id)).await?} else {api_key().ok_or("Configure an API key in ChatLGBT settings first.")?};
        let client=reqwest::Client::builder().timeout(Duration::from_secs(if lane=="prediction" {20} else {180})).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Could not initialize model connection.")?;
        let body=payload.wire_body()?;
        let send=client.post("https://api.openai.com/v1/responses").bearer_auth(&key).json(&body).send();
        let mut response=tokio::select! {
            _=cancel.changed()=>return Err("Request stopped.".to_string()),
            result=send=>result.map_err(|_| "Could not connect to the model service.".to_string())?,
        };
        if !response.status().is_success() {
            if uses_chatgpt {return Err(crate::chatgpt::provider_error(response,&key).await);}
            return Err(match response.status().as_u16() {
                401=>"The API key was rejected.", 403=>"The key cannot access this model.",
                404=>"Model not found. Check the model ID and account access.", 429=>"API rate or billing limit reached.",
                _=>"The model service returned an error. Try again shortly.",
            }.to_string());
        }
        let mut size=0;
        loop {
            let chunk=tokio::select! {
                _=cancel.changed()=>return Err("Request stopped.".to_string()),
                result=response.chunk()=>result.map_err(|_| "The model connection was interrupted.".to_string())?,
            };
            let Some(bytes)=chunk else {break};
            size+=bytes.len(); if size>4000000 {return Err("Response exceeded size limit.".into());}
            window.emit("chatlgbt-chunk",Chunk{id:id.clone(),chunk:bytes.to_vec()}).map_err(|_| "Could not deliver model response.".to_string())?;
        }
        Ok(())
    }.await;
    if let Ok(mut active)=state.active.lock() {if active.get(lane).is_some_and(|(running,_)|running==&id){active.remove(lane);}}
    result
}

#[cfg(test)]
mod request_tests {
    use super::*;
    #[tokio::test]
    async fn request_cancellation_finishes_credential_rotation_before_stopping(){
        let (sender,receiver)=watch::channel(false);let (started,mut wait)=watch::channel(false);
        let saved=std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));let checked=saved.clone();
        let renew=async move {
            started.send(true).unwrap();tokio::task::yield_now().await;
            saved.store(true,std::sync::atomic::Ordering::SeqCst);Ok("replacement-access".into())
        };
        let request=renewable_credentials(&receiver,renew);
        let cancel=async {wait.changed().await.unwrap();sender.send(true).unwrap();};
        let (result,_)=tokio::join!(request,cancel);
        assert_eq!(result.unwrap_err(),"Request stopped.");assert!(checked.load(std::sync::atomic::Ordering::SeqCst));
        assert!(renewable_credentials(&receiver,async {panic!("cancelled request must not start renewal")}).await.is_err());
    }
    #[test]
    fn chatgpt_wire_body_omits_unsupported_limits_and_local_account_metadata(){
        let mut request=Request{model:"gpt-6.1-sol".into(),instructions:"Help with code".into(),input:vec![Message{role:"user".into(),content:"Hello".into()}],max_output_tokens:6000,auth_provider:"chatgpt".into(),account_id:"oaiapp_test".into(),purpose:String::new()};
        let body=request.wire_body().unwrap();assert_eq!(body["stream"],true);assert_eq!(body["store"],false);for field in ["max_output_tokens","auth_provider","account_id"]{assert!(body.get(field).is_none());}
        request.auth_provider="api".into();assert_eq!(request.wire_body().unwrap()["max_output_tokens"],6000);
        request.auth_provider="unknown".into();assert!(request.wire_body().is_err());
    }
    #[test]
    fn prediction_limits_and_metadata_stay_local(){
        let mut request=Request{model:"gpt-6.1-sol".into(),instructions:"Complete code".into(),input:vec![Message{role:"user".into(),content:"const x =".into()}],max_output_tokens:1024,auth_provider:"api".into(),account_id:String::new(),purpose:"code_prediction".into()};
        let body=request.wire_body().unwrap();assert!(body.get("purpose").is_none());
        request.max_output_tokens=3000;assert!(request.validate().is_err());
        request.max_output_tokens=64;assert!(request.validate().is_ok());
    }
    #[test]
    fn cancelling_one_lane_does_not_cancel_the_other(){
        let state=AgentState::default();let (chat_sender,chat_receiver)=watch::channel(false);let (prediction_sender,prediction_receiver)=watch::channel(false);
        state.active.lock().unwrap().insert("chat".into(),("chat-id".into(),chat_sender));
        state.active.lock().unwrap().insert("prediction".into(),("prediction-id".into(),prediction_sender));
        {let active=state.active.lock().unwrap();for (id,sender) in active.values(){if id=="prediction-id"{sender.send(true).unwrap();}}}
        assert!(!*chat_receiver.borrow());assert!(*prediction_receiver.borrow());
        cancel_all(&state);assert!(*chat_receiver.borrow());
    }
}
