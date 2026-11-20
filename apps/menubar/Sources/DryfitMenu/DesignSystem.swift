import SwiftUI

/// The measurements the app is drawn to, taken from its wireframes: 12 pt text with 11 pt captions,
/// 0.5 pt hairlines, 8 pt corners on groups and buttons, 10 pt on cards. The system draws the glass
/// (the menu bar panel, the sidebar, the toolbar, sheets); everything inside is content, drawn flat.
enum DS {
  static let body = Font.system(size: 12)
  static let medium = Font.system(size: 12, weight: .medium)
  static let caption = Font.system(size: 11)
  static let small = Font.system(size: 10)
  static let mono = Font.system(size: 11, design: .monospaced)
  static let headline = Font.system(size: 13, weight: .medium)
  static let sheetTitle = Font.system(size: 14, weight: .medium)
  static let title = Font.system(size: 18, weight: .medium)

  /// The default hairline, between rows and around groups.
  static let hairline = Color.primary.opacity(0.1)
  /// Around buttons.
  static let strongBorder = Color.primary.opacity(0.2)
  /// A grey wash that shows on any background: badges, output.
  static let neutralFill = Color.primary.opacity(0.06)
  static let accentTint = Color.accentColor.opacity(0.14)
  /// Behind a group of rows or a card, so it reads as a surface on the window or the menu's glass.
  static let groupFill = Color.primary.opacity(0.045)
  /// Behind a button.
  static let buttonFill = Color.primary.opacity(0.07)
  static let radius: CGFloat = 8
}

extension EnvironmentValues {
  /// True inside the menu bar window, whose glass washes out faint text: captions there use the
  /// secondary grey, not the tertiary one the window uses.
  @Entry var onGlass = false
}

extension View {
  /// The grey for captions: tertiary in the window, secondary on the menu's glass.
  func captionStyle() -> some View { modifier(CaptionGrey()) }
}

private struct CaptionGrey: ViewModifier {
  @Environment(\.onGlass) private var onGlass
  func body(content: Content) -> some View {
    content.foregroundStyle(onGlass ? HierarchicalShapeStyle.secondary : HierarchicalShapeStyle.tertiary)
  }
}

/// A one-pixel line across the full width, snapped to the pixel grid so it never fades out.
struct Hairline: View {
  @Environment(\.displayScale) private var scale
  var body: some View { Rectangle().fill(DS.hairline).frame(height: 1 / scale) }
}

/// Rows on a filled rounded rectangle, with a hairline between each.
struct HairlineGroup<Content: View>: View {
  var border: Color? = nil
  @ViewBuilder var content: Content

  var body: some View {
    VStack(spacing: 0) {
      Group(subviews: content) { subviews in
        ForEach(Array(subviews.enumerated()), id: \.offset) { index, subview in
          if index > 0 { Hairline() }
          subview
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(DS.groupFill, in: .rect(cornerRadius: DS.radius))
    .overlay {
      // Only a warning group is outlined, in its colour; others are a fill, as macOS draws them.
      if let border { RoundedRectangle(cornerRadius: DS.radius).strokeBorder(border, lineWidth: 1) }
    }
  }
}

/// One row of a `HairlineGroup`: 7 by 10 pt of padding, 8 pt between its parts.
struct GroupRow<Content: View>: View {
  @ViewBuilder var content: Content

  var body: some View {
    HStack(spacing: 8) { content }
      .font(DS.body)
      .padding(.horizontal, 10)
      .padding(.vertical, 7)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// The small grey label above a group.
struct SectionLabel: View {
  let text: String
  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text).font(DS.caption).foregroundStyle(.secondary).padding(.top, 14).padding(.bottom, 4)
  }
}

/// The muted note under a group.
struct Footnote: View {
  let text: String
  init(_ text: String) { self.text = text }

  var body: some View {
    Text(text).font(DS.caption).captionStyle().padding(.top, 4)
      .fixedSize(horizontal: false, vertical: true)
  }
}

/// Two lines: a name and a muted caption under it.
struct TwoLine: View {
  let title: String
  let caption: String?
  var titleFont = DS.body
  /// Whether the caption wraps onto more lines instead of being cut short.
  var wraps = false

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Text(title).font(titleFont).lineLimit(1)
      if let caption {
        Text(caption).font(DS.caption).captionStyle()
          .lineLimit(wraps ? nil : 1)
          .fixedSize(horizontal: false, vertical: wraps)
      }
    }
  }
}

/// Two lines whose first is any view, such as a name with a badge.
struct TwoLineView<Title: View>: View {
  let title: Title
  let caption: String

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      title
      Text(caption).font(DS.caption).captionStyle().lineLimit(1)
    }
  }
}

// MARK: Buttons

/// The app's button: 11 pt text on a small filled rounded rectangle. One per screen is
/// `.primary`, filled; `.accent` and `.danger` colour the text for Link and for removing things.
struct PillButtonStyle: ButtonStyle {
  enum Kind { case normal, primary, accent, danger }
  var kind = Kind.normal

  func makeBody(configuration: Configuration) -> some View {
    PillLabel(kind: kind, pressed: configuration.isPressed) { configuration.label }
  }
}

extension ButtonStyle where Self == PillButtonStyle {
  static var pill: PillButtonStyle { PillButtonStyle() }
  static var primaryPill: PillButtonStyle { PillButtonStyle(kind: .primary) }
  static var accentPill: PillButtonStyle { PillButtonStyle(kind: .accent) }
  static var dangerPill: PillButtonStyle { PillButtonStyle(kind: .danger) }
}

/// A pill's look, for menus that open from one.
struct PillLabel<Label: View>: View {
  var kind = PillButtonStyle.Kind.normal
  var pressed = false
  @ViewBuilder var label: Label
  @Environment(\.isEnabled) private var isEnabled

  var body: some View {
    label
      .labelStyle(PillLabelStyle())
      .font(DS.caption)
      .lineLimit(1)
      .fixedSize()
      .padding(.horizontal, 8)
      .padding(.vertical, 2)
      .foregroundStyle(foreground)
      .background(kind == .primary ? AnyShapeStyle(Color.primary) : AnyShapeStyle(DS.buttonFill), in: .rect(cornerRadius: DS.radius))
      .contentShape(.rect)
      .opacity(isEnabled ? (pressed ? 0.7 : 1) : 0.35)
  }

  private var foreground: AnyShapeStyle {
    switch kind {
    case .normal: AnyShapeStyle(.secondary)
    case .primary: AnyShapeStyle(Color(nsColor: .windowBackgroundColor))
    case .accent: AnyShapeStyle(Color.accentColor)
    case .danger: AnyShapeStyle(Color.red)
    }
  }
}

/// Icon and title 4 pt apart, the icon at the text's size.
struct PillLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon
      configuration.title
    }
  }
}

/// A pill that opens a menu.
struct PillMenu<Items: View, Label: View>: View {
  var kind = PillButtonStyle.Kind.normal
  @ViewBuilder var items: Items
  @ViewBuilder var label: Label

  var body: some View {
    Menu { items } label: { PillLabel(kind: kind) { label } }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .fixedSize()
  }
}

/// An accent-tinted chip that links an app with one click.
struct ChipButtonStyle: ButtonStyle {
  var quiet = false

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .labelStyle(PillLabelStyle())
      .font(DS.caption)
      .lineLimit(1)
      .padding(.horizontal, 7)
      .padding(.vertical, 2)
      .foregroundStyle(quiet ? AnyShapeStyle(.secondary) : AnyShapeStyle(Color.accentColor))
      .background(quiet ? Color.clear : DS.accentTint, in: .rect(cornerRadius: DS.radius))
      .contentShape(.rect)
      .opacity(configuration.isPressed ? 0.7 : 1)
  }
}

/// A borderless symbol at caption size, muted, that shows a spinner while its action runs.
struct IconButton: View {
  let symbol: String
  let label: String
  let busy: Bool
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      ZStack {
        Image(systemName: symbol).opacity(busy ? 0 : 1)
        if busy { ProgressView().controlSize(.mini) }
      }
      .font(.system(size: 12))
      .foregroundStyle(.secondary)
      .frame(width: 18, height: 18)
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .disabled(busy)
    .help(label)
    .accessibilityLabel(label)
  }
}

// MARK: Switch

/// A 24 by 14 pt switch: accent when on, grey when off.
struct MiniSwitchStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    MiniSwitch(configuration: configuration)
  }

  private struct MiniSwitch: View {
    let configuration: Configuration
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
      Button {
        withAnimation(.snappy(duration: 0.18)) { configuration.isOn.toggle() }
      } label: {
        ZStack(alignment: configuration.isOn ? .trailing : .leading) {
          Capsule().fill(configuration.isOn ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color.primary.opacity(0.15)))
          Circle().fill(.white).padding(2).shadow(color: .black.opacity(0.15), radius: 0.5, y: 0.5)
        }
        .frame(width: 24, height: 14)
      }
      .buttonStyle(.plain)
      .opacity(isEnabled ? 1 : 0.5)
      .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
  }
}

extension ToggleStyle where Self == MiniSwitchStyle {
  static var mini: MiniSwitchStyle { MiniSwitchStyle() }
}

/// A 13 pt square checkbox with its label 8 pt after it: accent with a white tick when on.
struct Checkbox13Style: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      HStack(spacing: 8) {
        ZStack {
          if configuration.isOn {
            RoundedRectangle(cornerRadius: 4).fill(Color.accentColor)
            Image(systemName: "checkmark").font(.system(size: 8, weight: .bold)).foregroundStyle(.white)
          } else {
            RoundedRectangle(cornerRadius: 4).strokeBorder(DS.strongBorder, lineWidth: 0.5)
          }
        }
        .frame(width: 13, height: 13)
        configuration.label
      }
      .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
  }
}

extension ToggleStyle where Self == Checkbox13Style {
  static var checkbox13: Checkbox13Style { Checkbox13Style() }
}

extension View {
  /// A text field drawn flat: a hairline, 6 pt corners, 3 by 7 pt inside.
  func field(monospaced: Bool = false) -> some View {
    textFieldStyle(.plain)
      .font(monospaced ? DS.mono : DS.body)
      .padding(.horizontal, 7)
      .padding(.vertical, 3)
      .background(Color(nsColor: .textBackgroundColor).opacity(0.6), in: .rect(cornerRadius: 6))
      .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(DS.hairline, lineWidth: 0.5) }
  }
}

// MARK: Tiles, badges and cards

/// The square that stands for a library, an app or a group: a tinted wash with the symbol in the tint.
struct Tile: View {
  let symbol: String
  let tint: Color
  var size: CGFloat = 36

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.55))
      .foregroundStyle(tint)
      .frame(width: size, height: size)
      .background(tint.opacity(0.15), in: .rect(cornerRadius: size / 4))
      .accessibilityHidden(true)
  }
}

/// A small grey tag for a fact such as the package manager.
struct Badge: View {
  let text: String
  var tint: Color? = nil

  var body: some View {
    Text(text)
      .font(DS.small)
      .padding(.horizontal, 6)
      .padding(.vertical, 1)
      .foregroundStyle(tint.map(AnyShapeStyle.init) ?? AnyShapeStyle(.secondary))
      .background(tint.map { $0.opacity(0.15) } ?? DS.neutralFill, in: .rect(cornerRadius: 5))
  }
}

/// Says whether an app runs a library's dev build or its released version.
struct BuildChip: View {
  let dev: Bool
  var body: some View { Badge(text: dev ? "Dev build" : "Release", tint: dev ? .purple : nil) }
}

extension View {
  /// A card in the menu: 10 pt corners and a hairline, 6 by 8 pt inside.
  func card() -> some View {
    padding(.horizontal, 8)
      .padding(.vertical, 6)
      .background(DS.groupFill, in: .rect(cornerRadius: 10))
  }
}

// MARK: Pages

/// A page of the dryfit window: a bar of controls along the top, then the page, 18 pt in from the
/// sides. The bar is part of the page, not a toolbar: the window has no title bar.
struct Page<Bar: View, Content: View>: View {
  @ViewBuilder var bar: Bar
  @ViewBuilder var content: Content

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 8) { bar }
          .font(DS.body)
          .frame(minHeight: 20)
          .padding(.top, 10)
          .padding(.bottom, 12)
        content
      }
      .font(DS.body)
      .padding(.horizontal, 18)
      .padding(.bottom, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

/// The page's tile, name and one line about it.
struct PageHeader<Accessory: View>: View {
  let symbol: String
  let tint: Color
  let title: String
  let subtitle: String
  @ViewBuilder var accessory: Accessory

  var body: some View {
    HStack(spacing: 12) {
      Tile(symbol: symbol, tint: tint)
      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 6) {
          Text(title).font(DS.title).textSelection(.enabled).lineLimit(1)
          accessory
        }
        Text(subtitle).font(DS.body).foregroundStyle(.tertiary).fixedSize(horizontal: false, vertical: true)
      }
    }
  }
}

extension PageHeader where Accessory == EmptyView {
  init(symbol: String, tint: Color, title: String, subtitle: String) {
    self.init(symbol: symbol, tint: tint, title: title, subtitle: subtitle) { EmptyView() }
  }
}

/// A row's two lines with a badge after the name: "admin  pnpm".
struct NameAndBadge: View {
  let name: String
  let badge: String?

  var body: some View {
    HStack(spacing: 4) {
      Text(name).lineLimit(1)
      if let badge { Badge(text: badge) }
    }
  }
}
