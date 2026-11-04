// swift-tools-version:5.5
// Yonder iOS 设备能力插件：日历、提醒事项、通讯录、照片、位置、健康。
import PackageDescription

let package = Package(
    name: "tauri-plugin-yonder-device",
    platforms: [
        .macOS(.v10_13),
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-yonder-device",
            type: .static,
            targets: ["tauri-plugin-yonder-device"])
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api")
    ],
    targets: [
        .target(
            name: "tauri-plugin-yonder-device",
            dependencies: [
                .byName(name: "Tauri")
            ],
            path: "Sources")
    ]
)
