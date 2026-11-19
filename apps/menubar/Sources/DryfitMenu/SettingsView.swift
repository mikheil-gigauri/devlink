import DryfitAPI
import SwiftUI

/// dryfit's settings: where to look for apps, the background service, opening at login, and updates.
public struct SettingsView: View {
  let model: MenuModel
  let actions: MenuActions

  public init(model: MenuModel, actions: MenuActions) {
    self.model = model
    self.actions = actions
  }

  public var body: some View {
    Form {
      Section {
        if model.connection != .online {
          Text("Start dryfit to change these.").foregroundStyle(.secondary)
        } else if let roots = model.roots, !roots.isEmpty {
          ForEach(roots, id: \.self) { root in
            HStack {
              Label(abbreviatedPath(root), systemImage: "folder")
              Spacer()
              Button("Remove", systemImage: "minus.circle") {
                Task {
                  do {
                    try await model.setRoots(roots.filter { $0 != root })
                  } catch {}
                }
              }
              .labelStyle(.iconOnly)
              .buttonStyle(.borderless)
              .help("Stop looking in \(abbreviatedPath(root))")
            }
          }
        } else {
          Text("No folders yet. Add the folders that hold your apps.").foregroundStyle(.secondary)
        }
        HStack {
          Spacer()
          Button("Add Folder…") { Task { await model.chooseProjectFolders() } }
            .disabled(model.connection != .online)
        }
      } header: {
        Text("Project folders")
      } footer: {
        Text("dryfit looks in these folders, and the folders inside them, for apps that use your libraries.")
      }

      Section("dryfit service") {
        LabeledContent("Status", value: status)
        if let outdated = model.outdatedVersion {
          HStack {
            Label("dryfit \(outdated) is older than this app", systemImage: "arrow.up.circle.fill")
              .foregroundStyle(.orange)
            Spacer()
            UpdateDryfitControl(model: model, prominent: false)
          }
        }
        if let registry = model.status?.daemon.registryUrl, model.connection == .online {
          LabeledContent("Registry", value: registry)
        }
        HStack {
          Button("Open Log", action: actions.openLog)
          Spacer()
          switch model.connection {
          case .online:
            Button("Stop") { Task { await model.stopDaemon() } }
          case .offline:
            Button("Start") { Task { await model.startDaemon() } }
          default:
            EmptyView()
          }
        }
      }

      if let openAtLogin = actions.openAtLogin {
        Section("General") {
          Toggle("Open at login", isOn: openAtLogin)
        }
      }

      if let checkForUpdates = actions.checkForUpdates {
        Section {
          if let installAutomatically = actions.installUpdatesAutomatically {
            Toggle("Install updates automatically", isOn: installAutomatically)
          }
          HStack {
            Spacer()
            Button("Check Now", action: checkForUpdates)
          }
        } header: {
          Text("Updates")
        } footer: {
          Text("dryfit looks for a new version once a day and, when installing automatically, replaces itself while you are not using it.")
        }
      }
    }
    .formStyle(.grouped)
    .frame(width: 480)
    .fixedSize(horizontal: false, vertical: true)
    .showsInDock()
  }

  private var status: String {
    switch model.connection {
    case .online: model.status.map { "Running, version \($0.daemon.version)" } ?? "Running"
    case .connecting: "Looking for dryfit…"
    case .starting: "Starting…"
    case .offline: "Not running"
    case .incompatible(let version): "dryfit \(version) does not match this app"
    }
  }
}
