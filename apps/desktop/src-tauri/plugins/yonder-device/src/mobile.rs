use serde::{Deserialize, de::DeserializeOwned};
use tauri::{AppHandle, Runtime};
use tauri::plugin::{PluginApi, PluginHandle};
use crate::models::*;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_yonder_device);

pub fn init<R: Runtime, C: DeserializeOwned>(
	_app: &AppHandle<R>,
	api: PluginApi<R, C>,
) -> crate::Result<YonderDevice<R>> {
	#[cfg(target_os = "ios")]
	let handle = api.register_ios_plugin(init_plugin_yonder_device)?;
	#[cfg(any(target_os = "android", all(desktop, target_os = "linux"), target_os = "macos", target_os = "windows"))]
	unreachable!("yonder-device 只在 iOS 壳里注册");
	Ok(YonderDevice(handle))
}

/// 指向 iOS Swift 插件的句柄；每个命令把参数原样转给 Swift，结果反序列化回模型。
pub struct YonderDevice<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> YonderDevice<R> {
	pub fn status(&self, kind: &str) -> crate::Result<DeviceStatus> {
		self.0
			.run_mobile_plugin("status", serde_json::json!({ "kind": kind }))
			.map_err(Into::into)
	}

	pub fn request(&self, kind: &str) -> crate::Result<DeviceStatus> {
		self.0
			.run_mobile_plugin("request", serde_json::json!({ "kind": kind }))
			.map_err(Into::into)
	}

	pub fn calendar_events(&self, from: i64, to: i64) -> crate::Result<Vec<CalendarEvent>> {
		self.0
			.run_mobile_plugin("calendarEvents", CalendarRangeArgs { from, to })
			.map(|r: CalendarEventsResponse| r.events)
			.map_err(Into::into)
	}

	pub fn reminders(&self) -> crate::Result<Vec<Reminder>> {
		self.0
			.run_mobile_plugin("reminders", ())
			.map(|r: RemindersResponse| r.reminders)
			.map_err(Into::into)
	}

	pub fn contacts(&self) -> crate::Result<Vec<Contact>> {
		self.0
			.run_mobile_plugin("contacts", ())
			.map(|r: ContactsResponse| r.contacts)
			.map_err(Into::into)
	}

	pub fn photos_status(&self) -> crate::Result<DeviceStatus> {
		self.0
			.run_mobile_plugin("photosStatus", ())
			.map_err(Into::into)
	}

	pub fn location(&self) -> crate::Result<GeoLocation> {
		self.0
			.run_mobile_plugin("location", ())
			.map_err(Into::into)
	}

	pub fn health(&self) -> crate::Result<HealthSnapshot> {
		self.0
			.run_mobile_plugin("health", ())
			.map_err(Into::into)
	}
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CalendarEventsResponse {
	events: Vec<CalendarEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemindersResponse {
	reminders: Vec<Reminder>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContactsResponse {
	contacts: Vec<Contact>,
}
