use serde::{de::DeserializeOwned, Serialize};
use tauri::{
	command,
	AppHandle, Manager, Runtime,
	plugin::{Builder, PluginApi, TauriPlugin},
	State,
};

use crate::models::*;

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

#[cfg(desktop)]
pub use desktop::YonderDevice;
#[cfg(mobile)]
pub use mobile::YonderDevice;

mod models;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
	#[error(transparent)]
	PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
	#[cfg(desktop)]
	#[error("{0}")]
	Unsupported(String),
}

impl Serialize for Error {
	fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
	where
		S: serde::Serializer,
	{
		serializer.serialize_str(&self.to_string())
	}
}

/// 插件名：网页经 `plugin:yonder-device|<命令>` 调用。
const PLUGIN_NAME: &str = "yonder-device";

fn kind_arg(kind: String) -> String {
	kind
}

#[command]
async fn status<R: Runtime>(
	_app: AppHandle<R>,
	device: State<'_, YonderDevice<R>>,
	kind: String,
) -> Result<DeviceStatus> {
	device.status(&kind_arg(kind))
}

#[command]
async fn request<R: Runtime>(
	_app: AppHandle<R>,
	device: State<'_, YonderDevice<R>>,
	kind: String,
) -> Result<DeviceStatus> {
	device.request(&kind_arg(kind))
}

#[command]
async fn calendar_events<R: Runtime>(
	_app: AppHandle<R>,
	device: State<'_, YonderDevice<R>>,
	from: i64,
	to: i64,
) -> Result<Vec<CalendarEvent>> {
	device.calendar_events(from, to)
}

#[command]
async fn reminders<R: Runtime>(_app: AppHandle<R>, device: State<'_, YonderDevice<R>>) -> Result<Vec<Reminder>> {
	device.reminders()
}

#[command]
async fn contacts<R: Runtime>(_app: AppHandle<R>, device: State<'_, YonderDevice<R>>) -> Result<Vec<Contact>> {
	device.contacts()
}

#[command]
async fn photos_status<R: Runtime>(_app: AppHandle<R>, device: State<'_, YonderDevice<R>>) -> Result<DeviceStatus> {
	device.photos_status()
}

#[command]
async fn location<R: Runtime>(_app: AppHandle<R>, device: State<'_, YonderDevice<R>>) -> Result<GeoLocation> {
	device.location()
}

#[command]
async fn health<R: Runtime>(_app: AppHandle<R>, device: State<'_, YonderDevice<R>>) -> Result<HealthSnapshot> {
	device.health()
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
	Builder::new(PLUGIN_NAME)
		.invoke_handler(tauri::generate_handler![
			status,
			request,
			calendar_events,
			reminders,
			contacts,
			photos_status,
			location,
			health,
		])
		.setup(|app, api| {
			let device: YonderDevice<R> = init_device(app, api)?;
			app.manage(device);
			Ok(())
		})
		.build()
}

fn init_device<R: Runtime, C: DeserializeOwned>(
	app: &AppHandle<R>,
	api: PluginApi<R, C>,
) -> Result<YonderDevice<R>> {
	#[cfg(mobile)]
	return mobile::init(app, api);
	#[cfg(desktop)]
	return desktop::init(app, api);
}
