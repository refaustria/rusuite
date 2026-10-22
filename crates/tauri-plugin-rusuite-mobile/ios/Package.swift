// swift-tools-version:5.5
// Rusuite's mobile document access on iOS (P10-M1); built into the apps' Xcode projects by Tauri.

import PackageDescription

let package = Package(
  name: "tauri-plugin-rusuite-mobile",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-rusuite-mobile",
      type: .static,
      targets: ["tauri-plugin-rusuite-mobile"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-rusuite-mobile",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
