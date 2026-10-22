// swift-tools-version: 6.1
import PackageDescription

// Research executable only; not part of the Yonder build, service, or plugin.
let package = Package(
    name: "PermissionDemo",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/jaywcjlove/PermissionFlow.git",
                 revision: "cb96db4bfd2342e8d8c56f2a7d51ca65b8aed6e2")
    ],
    targets: [.executableTarget(name: "PermissionDemo", dependencies: [
        .product(name: "PermissionFlow", package: "PermissionFlow"),
        .product(name: "PermissionFlowScreenRecordingStatus", package: "PermissionFlow"),
        .product(name: "PermissionFlowInputMonitoringStatus", package: "PermissionFlow")
    ])]
)
