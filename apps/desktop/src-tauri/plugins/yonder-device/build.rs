const COMMANDS: &[&str] = &[
	"status",
	"request",
	"calendar_events",
	"reminders",
	"contacts",
	"photos_status",
	"location",
	"health",
];

fn main() {
	tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
