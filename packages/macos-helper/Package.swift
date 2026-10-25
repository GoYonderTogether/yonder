// swift-tools-version: 6.1
import PackageDescription

// Explicit guide only; status never initializes PermissionFlow UI.
let package = Package(
    name: "YonderHelper",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/jaywcjlove/PermissionFlow.git",
                 revision: "cb96db4bfd2342e8d8c56f2a7d51ca65b8aed6e2")
    ],
    targets: [.executableTarget(name: "YonderHelper", dependencies: [
        .product(name: "PermissionFlow", package: "PermissionFlow"),
        .product(name: "PermissionFlowScreenRecordingStatus", package: "PermissionFlow"),
        .product(name: "PermissionFlowInputMonitoringStatus", package: "PermissionFlow")
    ]), .testTarget(name: "YonderHelperTests", dependencies: ["YonderHelper"])]
)
