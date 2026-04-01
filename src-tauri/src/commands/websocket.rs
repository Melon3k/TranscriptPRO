use crate::subtitle::types::{AppError, Subtitle};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, Mutex};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use futures_util::{SinkExt, StreamExt};

const WS_PORT: u16 = 7890;

#[derive(Default)]
pub struct WsServerState {
    tx: Option<broadcast::Sender<String>>,
}

#[tauri::command]
pub async fn start_ws_server(
    app: AppHandle,
    state: State<'_, Arc<Mutex<WsServerState>>>,
) -> Result<(), AppError> {
    let mut locked = state.lock().await;

    // Already running — no-op
    if locked.tx.is_some() {
        return Ok(());
    }

    let listener = TcpListener::bind(format!("127.0.0.1:{WS_PORT}"))
        .await
        .map_err(|e| AppError::Other(format!("Cannot bind WS server on port {WS_PORT}: {e}")))?;

    let (tx, _) = broadcast::channel::<String>(64);
    locked.tx = Some(tx.clone());
    drop(locked);

    let app_clone = app.clone();
    app.emit("ws-server-started", ()).ok();

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _addr)) => {
                    let tx2 = tx.clone();
                    let rx = tx2.subscribe();
                    let app2 = app_clone.clone();

                    tokio::spawn(handle_connection(stream, tx2, rx, app2));
                }
                Err(e) => {
                    eprintln!("[WS] accept error: {e}");
                }
            }
        }
    });

    Ok(())
}

async fn handle_connection(
    stream: tokio::net::TcpStream,
    tx: broadcast::Sender<String>,
    mut rx: broadcast::Receiver<String>,
    app: AppHandle,
) {
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[WS] handshake error: {e}");
            return;
        }
    };

    app.emit("ws-client-connected", ()).ok();

    let (mut ws_tx, mut ws_rx) = ws_stream.split();

    loop {
        tokio::select! {
            // Outbound: broadcast → ws client
            msg = rx.recv() => {
                match msg {
                    Ok(text) => {
                        if ws_tx.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }

            // Inbound: ws client → Tauri event
            incoming = ws_rx.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let text_str: String = text.into();
                        // Re-broadcast to any other connected clients (future multi-client)
                        tx.send(text_str.clone()).ok();
                        app.emit("ws-message-received", text_str).ok();
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    app.emit("ws-client-disconnected", ()).ok();
}

#[tauri::command]
pub async fn push_subtitles_to_premiere(
    subtitles: Vec<Subtitle>,
    state: State<'_, Arc<Mutex<WsServerState>>>,
) -> Result<(), AppError> {
    let locked = state.lock().await;
    let tx = locked
        .tx
        .as_ref()
        .ok_or_else(|| AppError::Other("WS server not running".into()))?;

    let msg = serde_json::json!({
        "type": "SET_SUBTITLES",
        "payload": subtitles,
    })
    .to_string();

    tx.send(msg)
        .map_err(|_| AppError::Other("No Premiere plugin connected".into()))?;

    Ok(())
}

#[tauri::command]
pub async fn get_ws_server_status(
    state: State<'_, Arc<Mutex<WsServerState>>>,
) -> Result<bool, AppError> {
    Ok(state.lock().await.tx.is_some())
}
