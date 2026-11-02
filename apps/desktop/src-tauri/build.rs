fn main() {
    // `YONDER_MOBILE_ORIGIN` 是编译期常量（option_env!，见 src/lib.rs）：改了地址必须重编，
    // 否则 cargo 复用旧产物，壳还在打上一个地址（真机 / 模拟器验收时实测过）。
    println!("cargo:rerun-if-env-changed=YONDER_MOBILE_ORIGIN");
    tauri_build::build()
}
