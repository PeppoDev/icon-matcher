# Icon Matcher

A GNOME Shell extension that fixes broken app icons in the dock and overview.


## Disclaimer

It could cause some mismatches because I have no control over what you have on your computer and the combinations are infinite. All tests were done on my setup and a few other computers. So if it causes some troubles, mismatches or apps without a match even though it's an easy match, please report it and I will look at it.


## Features

- Matching window to desktop entry on-demand
  - Obvious matches
  - Harder cases with heuristics
  - It was designed for games but it fixes all apps that fit those cases
  - Match steam xorg proton games by exec
- Multiple match
  - It can match more than one version of the game at the same time (native, proton x11, proton wayland). Since the extension stores by wmclass we can have it more than once with the right values for each version without affecting each other. It's easy to change between them and still have the match for your current version
  - If the game has a modal before it opens, sometimes it can fix it if the modal has enough information that can be linked to the game without affecting the game match itself.
- One-time fix
  - It fixes permanently (if nothing changes) when a match is found
  - No need for manual intervention
  - Changing the version needs to rematch but after the first launch it will be fixed permanently
- Easy to toggle
  - It can be toggled without affecting your desktop experience. And all matched desktop entries will keep working even with the extension disabled
  - It's easy to undo what the extension did if you want, just delete the folder that the extension created (`/home/<user>/.local/share/applications/icons-matched`) or the generated file itself for a more particular problem
  

## Usage


### Installation

Waiting for review, will soon be available on the extension store.

### Script Installation

I created a script to easily install the extension on your computer.

```bash
chmod +x .scripts/install.sh
./.scripts/install.sh
```

###  Manual Installation

If you want to do it yourself, you need to download the files and create a folder on `/home/<user>/.local/share/gnome-shell/extensions` with the name `icon-matcher@peppodev` and put extension.js and metadata.json inside it. I think it will need a logout in order to show this extension inside the extension manager.

### Watch logs

If you want to keep track of what the extension is doing, just check this. And of course, if you want to report an issue remember to include the logs to make it easy to fix. 

```bash
journalctl -f /usr/bin/gnome-shell | grep '\[IconMatcher\]'
```

## How does it work?

This fixes your applications on demand whenever a new window is created without the right desktop entry associated to it. It uses extension privileges for searching apps, windows and their information. It tries to match by a desktop entry that the algorithm thinks is the "100% right one" and fixes the desktop file (kinda). What happens if it did not find the "100% right one"? Well, sometimes we don't need to be exactly right — close enough is okay. In other words, the algorithm will try to heuristically resolve your desktop entry by scoring all available ones based on some window metadata (title, wmclass and appid if available) and if something scores close enough, we match to it.


### Did it mess with your desktop entries?

No, the extension by default does not override any desktop entry on your computer. It only creates a new file inside the applications path (~/.local/share/applications/icons-matched) that mirrors the original except for the fixed StartupWMClass. It will also have NoDisplay=true to avoid duplication on app menus. It's important to say that you can delete this folder created by the extension to undo everything if something goes wrong.


### Did it impact the computer performance?

I don't think so but it's hard to check how many resources have been spent on these tasks since the extension resources blend with GNOME Shell. I personally don't feel any impact on my computer but if you feel that something is off with the extension, just report it.

### Was it created by AI?

If the question is "Did you use AI?" the answer is yes. But if the question is "Did AI write all the code?" the answer is no. I wrote my own code — the entire heuristic algorithm was created outside a GNOME extension environment and tested against an array mocked based on my own set of apps. With those mocked values I tested which scores make more sense and whether they should stack between weak assertions, etc. Why did I use AI? Creating extensions on GNOME is not hard since everything is JS, but finding the right documentation and the right types — that's the real challenge.

### Is it stable?

I tested it on my personal use case and a few other computers and everything looks fine. There are no unmatched apps that should be matched and no matched apps that should not be matched. Although there are some unnecessary matches happening from time to time. It could also not work if the window does not have enough information to match or if some rule works unexpectedly on your use case. But even with bad behavior you can just delete the folder and reset what the extension did. I will also improve the rules and scoring as problems are reported.


## Known Issues

- It's not exactly an issue, but if the window does not have enough information it's simply unfixable without manual intervention. 
- Sometimes it matches windows that already have a match, but it's harmless for now since it still matches correctly — even though it's unnecessary — and I am looking into it.
- For anything else, please report it.

## Future Improvements

- User settings for better control.
- A reset button to delete every auto-generated desktop entry.
- A blacklist for wmclass.
- A better way to view what did not match (currently only through logs).
- Improve rules (if necessary).
