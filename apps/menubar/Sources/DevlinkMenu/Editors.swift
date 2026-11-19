import DevlinkAPI
import SwiftUI

/// Adds a library, or changes how one is built: shows what devlink detected and lets the user correct
/// the build command and the folder that gets published.
struct LibraryEditor: View {
  let root: String
  let model: MenuModel
  let navigation: AppNavigation
  @Environment(\.dismiss) private var dismiss
  @State private var preview: LibraryPreview?
  @State private var buildLine = ""
  @State private var publishDir = ""
  @State private var loadError: String?
  @State private var saveError: String?
  @State private var saving = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let preview {
        form(preview)
      } else if let loadError {
        ContentUnavailableView {
          Label("Not a library", systemImage: "shippingbox")
        } description: {
          Text(loadError)
        }
        .frame(height: 220)
      } else {
        ProgressView("Reading \(projectName(root))’s package.json…").frame(maxWidth: .infinity, minHeight: 220)
      }
      Divider()
      HStack {
        if saving { ProgressView().controlSize(.small) }
        Spacer()
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Button(preview?.registered == true ? "Save" : "Add Library") { save() }
          .keyboardShortcut(.defaultAction)
          .disabled(preview == nil || publishDir.isEmpty || saving)
      }
      .padding(16)
    }
    .frame(width: 520)
    .task {
      do {
        let found = try await model.inspect(root)
        buildLine = found.build?.line ?? ""
        publishDir = found.publishDir
        preview = found
      } catch {
        loadError = error.localizedDescription
      }
    }
  }

  private func form(_ preview: LibraryPreview) -> some View {
    Form {
      Section {
        HStack(spacing: 12) {
          Tile(symbol: "shippingbox", tint: .teal, size: 40)
          VStack(alignment: .leading, spacing: 1) {
            Text(preview.registered ? "Build settings for \(preview.name)" : "Add \(preview.name)")
              .font(.title3.bold())
            Text("\(preview.version) · \(abbreviatedPath(preview.root))").foregroundStyle(.secondary).lineLimit(1)
          }
        }
      }
      Section {
        TextField("Build command", text: $buildLine, prompt: Text("No build step"))
      } footer: {
        Text("Runs in the library's folder before each publish." + (preview.registered ? "" : " \(detectedNote(preview))"))
      }
      Section {
        LabeledContent("Publish folder") {
          HStack {
            Text(abbreviatedPath(publishDir)).lineLimit(1).truncationMode(.head)
            Button("Choose…") { Task { await choosePublishDir() } }
          }
        }
      } footer: {
        Text("The folder whose package.json gets published, usually where the build writes its output.")
      }
      if let saveError {
        Section {
          Label(saveError, systemImage: "exclamationmark.circle.fill").foregroundStyle(.red)
        }
      }
    }
    .formStyle(.grouped)
    .scrollDisabled(true)
    .fixedSize(horizontal: false, vertical: true)
  }

  private func detectedNote(_ preview: LibraryPreview) -> String {
    switch preview.detected {
    case "nx": "Detected an Nx library."
    case "angular": "Detected an Angular CLI library."
    case "npm-script": "Detected the build script in package.json."
    default: "devlink found no build step. Add a command if the library needs one."
    }
  }

  private func choosePublishDir() async {
    let chosen = await FolderPanel.choose(
      prompt: "Choose", message: "Choose the folder whose package.json gets published.", startingAt: root)
    if let folder = chosen.first { publishDir = folder }
  }

  private func save() {
    saving = true
    saveError = nil
    Task {
      do {
        try await model.register(root, publishDir: publishDir, build: BuildCommand(line: buildLine))
        if let name = preview?.name { navigation.selection = .library(name) }
        dismiss()
      } catch {
        saveError = error.localizedDescription
      }
      saving = false
    }
  }
}

/// Creates a group, or changes which apps one holds.
struct GroupEditor: View {
  let request: GroupEditorRequest
  let model: MenuModel
  let navigation: AppNavigation
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var members: [String] = []
  @State private var extra: [String] = []
  @State private var saveError: String?
  @State private var saving = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Form {
        Section {
          TextField("Name", text: $name, prompt: Text("storefront"))
            .disabled(isEditing)
        } footer: {
          Text("A group links a library into all of its apps at once.")
        }
        Section("Apps") {
          if projects.isEmpty {
            Text("No apps found in your project folders. Add one below.").foregroundStyle(.secondary)
          }
          ForEach(projects, id: \.self) { project in
            Toggle(isOn: Binding(
              get: { members.contains(project) },
              set: { on in
                if on { members.append(project) } else { members.removeAll { $0 == project } }
              })
            ) {
              VStack(alignment: .leading, spacing: 1) {
                Text(projectName(project))
                Text(abbreviatedPath(project)).font(.caption).foregroundStyle(.secondary)
              }
            }
          }
          HStack {
            Spacer()
            Button("Add App…") { Task { await addFolder() } }
          }
        }
        if let saveError {
          Section { Label(saveError, systemImage: "exclamationmark.circle.fill").foregroundStyle(.red) }
        }
      }
      .formStyle(.grouped)
      .frame(minHeight: 280, maxHeight: 460)
      Divider()
      HStack {
        Spacer()
        Button("Cancel", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
        Button(isEditing ? "Save" : "Create Group") { save() }
          .keyboardShortcut(.defaultAction)
          .disabled(trimmedName.isEmpty || members.isEmpty || saving)
      }
      .padding(16)
    }
    .frame(width: 460)
    .onAppear {
      if case .edit(let group) = request {
        name = group.name
        members = group.consumers
      }
    }
  }

  private var isEditing: Bool {
    if case .edit = request { true } else { false }
  }

  private var trimmedName: String { name.trimmingCharacters(in: .whitespaces) }

  private var projects: [String] {
    var all = model.knownProjects
    for path in extra + members where !all.contains(path) { all.append(path) }
    return all
  }

  private func addFolder() async {
    let chosen = await FolderPanel.choose(
      prompt: "Add", message: "Choose apps to add to the group.", multiple: true, startingAt: model.roots?.first)
    for path in chosen where !projects.contains(path) { extra.append(path) }
    for path in chosen where !members.contains(path) { members.append(path) }
  }

  private func save() {
    saving = true
    saveError = nil
    Task {
      do {
        try await model.saveGroup(trimmedName, consumers: members)
        navigation.selection = .group(trimmedName)
        dismiss()
      } catch {
        saveError = error.localizedDescription
      }
      saving = false
    }
  }
}
