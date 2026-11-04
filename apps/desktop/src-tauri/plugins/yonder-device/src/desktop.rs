use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Runtime};

use crate::models::*;

/// 桌面没有这套原生能力：一律返回 unsupported，不伪造结果。
pub fn init<R: Runtime, C: DeserializeOwned>(
	_app: &AppHandle<R>,
	_api: tauri::plugin::PluginApi<R, C>,
) -> crate::Result<YonderDevice<R>> {
	Ok(YonderDevice)
}

#[derive(Clone, Copy)]
pub struct YonderDevice<R: Runtime>(std::marker::PhantomData<R>);

const UNSUPPORTED: &str = "yonder-device 仅在 iOS 壳里可用";

impl<R: Runtime> YonderDevice<R> {
	pub fn status(&self, _kind: &str) -> crate::Result<DeviceStatus> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
	pub fn request(&self, _kind: &str) -> crate::Result<DeviceStatus> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
	pub fn calendar_events(&self, _from: i64, _to: i64) -> crate::Result<Vec<CalendarEvent>> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
	pub fn reminders(&self) -> crate::Result<Vec<Reminder>> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
	pub fn contacts(&self) -> crate::Result<Vec<Contact>> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
	pub fn photos_status(&self) -> crate::Result<DeviceStatus> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
	pub fn location(&self) -> crate::Result<GeoLocation> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
	pub fn health(&self) -> crate::Result<HealthSnapshot> {
		Err(crate::Error::Unsupported(UNSUPPORTED.into()))
	}
}
