import DryfitAPI
import SwiftUI

/// dryfit's settings, a page of the dryfit window: where to look for apps, the background service,
/// opening at login, and updates.
public struct SettingsView: View {
  let model: MenuModel
  let actions: MenuActions

  public init(model: MenuModel, actions: MenuActions) {
    self.model = model
    self.actions = actions
  }

  public var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        Text("Settings").font(DS.title)

        SectionLabel("Project folders")
        HairlineGroup {
          if model.connection != .online {
            GroupRow { Text("Start dryfit to change these.").foregroundStyle(.tertiary) }
          } else if let roots = model.roots, !roots.isEmpty {
            ForEach(roots, id: \.self) { root in
              GroupRow {
                Image(systemName: "folder").accessibilityHidden(true)
                Text(abbreviatedPath(root)).lineLimit(1).truncationMode(.head)
                Spacer(minLength: 8)
                Button {
                  Task { try? await model.setRoots(roots.filter { $0 != root }) }
                } label: {
                  Image(systemName: "minus.circle").foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
                .help("Stop looking in \(abbreviatedPath(root))")
                .accessibilityLabel("Remove \(abbreviatedPath(root))")
              }
            }
          } else {
            GroupRow { Text("No folders yet. Add the folders that hold your apps.").foregroundStyle(.tertiary) }
          }
          GroupRow {
            Spacer()
            Button("Add folder…") { Task { await model.chooseProjectFolders() } }
              .buttonStyle(.pill)
              .disabled(model.connection != .online)
          }
        }
        Footnote("dryfit looks in these folders for apps that use your libraries.")

        if let hidden = model.hiddenApps, !hidden.isEmpty, model.connection == .online {
          SectionLabel("Hidden apps")
          HairlineGroup {
            ForEach(hidden, id: \.self) { root in
              GroupRow {
                Image(systemName: "eye.slash").accessibilityHidden(true)
                Text(projectName(root)).lineLimit(1)
                Spacer(minLength: 8)
                Button("Show") { Task { await model.showApp(root) } }
                  .buttonStyle(.pill)
                  .disabled(model.isBusy(.hide(root)))
                  .help("List \(projectName(root)) again")
              }
              .help(abbreviatedPath(root))
            }
          }
        }

        SectionLabel("dryfit service")
        HairlineGroup {
          GroupRow {
            Text("Status")
            Spacer(minLength: 8)
            Text(status).foregroundStyle(.secondary)
          }
          if let outdated = model.outdatedVersion {
            GroupRow {
              Image(systemName: "arrow.up.circle").foregroundStyle(.orange)
              Text("dryfit \(outdated) is older than this app")
              Spacer(minLength: 8)
              UpdateDryfitControl(model: model, prominent: false)
            }
          }
          if let registry = model.status?.daemon.registryUrl, model.connection == .online {
            GroupRow {
              Text("Registry")
              Spacer(minLength: 8)
              Text(registry).foregroundStyle(.secondary).textSelection(.enabled)
            }
          }
          GroupRow {
            Button("Open log", action: actions.openLog).buttonStyle(.pill)
            Spacer()
            switch model.connection {
            case .online:
              Button("Stop") { Task { await model.stopDaemon() } }.buttonStyle(.pill)
            case .offline:
              Button("Start") { Task { await model.startDaemon() } }.buttonStyle(.pill)
            default:
              EmptyView()
            }
          }
        }

        if let openAtLogin = actions.openAtLogin {
          SectionLabel("General")
          HairlineGroup {
            GroupRow {
              Text("Open at login")
              Spacer()
              Toggle("Open at login", isOn: openAtLogin).toggleStyle(.mini)
            }
          }
        }

        if let checkForUpdates = actions.checkForUpdates {
          SectionLabel("Updates")
          HairlineGroup {
            if let installAutomatically = actions.installUpdatesAutomatically {
              GroupRow {
                Text("Install updates automatically")
                Spacer()
                Toggle("Install updates automatically", isOn: installAutomatically).toggleStyle(.mini)
              }
            }
            GroupRow {
              Spacer()
              Button("Check now", action: checkForUpdates).buttonStyle(.pill)
            }
          }
          Footnote("dryfit looks for a new version once a day and, when installing automatically, replaces itself while you're not using it.")
        }
      }
      .font(DS.body)
      .padding(.horizontal, 18)
      .padding(.top, 16)
      .padding(.bottom, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
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
