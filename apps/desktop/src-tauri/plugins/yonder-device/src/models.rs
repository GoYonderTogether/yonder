use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatus {
	/// granted / denied / prompt（iOS 权限三态，与 Tauri PermissionState 一致）。
	pub state: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarRangeArgs {
	/// Unix 秒；闭区间 [from, to]。
	pub from: i64,
	pub to: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
	pub id: String,
	pub title: String,
	/// Unix 秒。
	pub starts_at: i64,
	pub ends_at: i64,
	pub all_day: bool,
	pub calendar: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
	pub id: String,
	pub title: String,
	pub notes: Option<String>,
	pub done: bool,
	/// Unix 秒；无截止日期为 None。
	pub due_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
	pub id: String,
	pub name: String,
	pub phones: Vec<String>,
	pub emails: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoLocation {
	pub latitude: f64,
	pub longitude: f64,
	/// 水平精度（米）。
	pub accuracy: f64,
	/// Unix 秒。
	pub timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSample {
	/// Unix 秒。
	pub start: i64,
	pub end: i64,
	pub value: f64,
	pub unit: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
	pub steps: Vec<HealthSample>,
	pub sleep: Vec<HealthSample>,
	pub heart_rate: Vec<HealthSample>,
}
