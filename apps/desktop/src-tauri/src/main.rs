// 桌面入口；移动端由 lib.rs 的 run() 经各平台生成的壳调用。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    yonder_desktop_lib::run()
}
