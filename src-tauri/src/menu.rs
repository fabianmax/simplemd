//! Native macOS menu. Menu items emit a single "menu" event to the webview
//! with the item id as payload; the frontend dispatches on it.
//!
//! Deliberately absent: Undo/Redo/Select All predefined items. Their native
//! selectors route to WebKit's (empty) undo manager instead of CodeMirror's
//! history — omitting them lets ⌘Z/⇧⌘Z/⌘A reach the webview keydown handler
//! where CM6 handles them. Cut/Copy/Paste ARE included: their selectors route
//! into the webview correctly and CM6 handles the resulting DOM events.

use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Wry};

pub fn build(app: &AppHandle, recents: &[String]) -> tauri::Result<Menu<Wry>> {
    let app_menu = SubmenuBuilder::new(app, "simplemd")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let mut recent_builder = SubmenuBuilder::new(app, "Open Recent");
    for path in recents {
        let name = std::path::Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        recent_builder = recent_builder.item(
            &MenuItemBuilder::new(name).id(format!("recent:{path}")).build(app)?,
        );
    }
    let recent = recent_builder.build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::new("New Tab").id("new-tab").accelerator("CmdOrCtrl+T").build(app)?)
        .item(&MenuItemBuilder::new("Open…").id("open").accelerator("CmdOrCtrl+O").build(app)?)
        .item(&recent)
        .separator()
        .item(&MenuItemBuilder::new("Save").id("save").accelerator("CmdOrCtrl+S").build(app)?)
        .separator()
        // ⌘W closes the TAB (close_window predefined would take the accelerator).
        .item(&MenuItemBuilder::new("Close Tab").id("close-tab").accelerator("CmdOrCtrl+W").build(app)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .cut()
        .copy()
        .paste()
        .build()?;

    let mut fmt = SubmenuBuilder::new(app, "Format");
    let items: &[(&str, &str, Option<&str>)] = &[
        ("Bold", "fmt:bold", Some("CmdOrCtrl+B")),
        ("Italic", "fmt:italic", Some("CmdOrCtrl+I")),
        ("Strikethrough", "fmt:strike", None),
        ("Inline Code", "fmt:code", Some("CmdOrCtrl+Shift+C")),
        ("Link", "fmt:link", Some("CmdOrCtrl+K")),
    ];
    for (label, id, accel) in items {
        let mut b = MenuItemBuilder::new(*label).id(*id);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        fmt = fmt.item(&b.build(app)?);
    }
    fmt = fmt.separator();
    for level in 0..=6u8 {
        let label = if level == 0 { "Paragraph".to_string() } else { format!("Heading {level}") };
        fmt = fmt.item(
            &MenuItemBuilder::new(label)
                .id(format!("fmt:h{level}"))
                .accelerator(format!("CmdOrCtrl+{level}"))
                .build(app)?,
        );
    }
    fmt = fmt.separator();
    for (label, id) in [
        ("Bullet List", "fmt:list"),
        ("Task List", "fmt:task"),
        ("Code Fence", "fmt:fence"),
        ("Table", "fmt:table"),
    ] {
        fmt = fmt.item(&MenuItemBuilder::new(label).id(id).build(app)?);
    }
    let format_menu = fmt.build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::new("Toggle File Browser")
                .id("toggle-browser")
                .accelerator("CmdOrCtrl+Shift+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new("Quick Switch…")
                .id("quick-switch")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::new("Toggle Raw Source")
                .id("toggle-preview")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .build()?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &format_menu, &view_menu])
}

pub fn rebuild(app: &AppHandle, recents: &[String]) -> tauri::Result<()> {
    app.set_menu(build(app, recents)?)?;
    Ok(())
}

pub fn attach_handler(app: &AppHandle) {
    app.on_menu_event(|app, event| {
        let _ = app.emit("menu", event.id().as_ref());
    });
}
