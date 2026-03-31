# Icon Matcher

A GNOME Shell extension that fixes broken app icons in the dock and overview.


## Features

Matching window to desktop entry on-demand

Obvious matches

it can match harder cases using heuristic

It was design for games but it fix all apps that fit on those cases

It can multiple match. 
Even if the game has more than one version (Example: Native, proton x11, proton wayland) it can match all of them since it stores by wmclass.

If the game has a modal before it opens sometimes it can fix it if the modal has enough information that can be linked to the game.

One time fix
After the first launch it will try resolve the desktop entry, if it founds a candidate you will not need to do anything in the future.

Easy to toggle


Easy to undo
Can be better.





## Usage

### Installation


### Manual Installation


### Watch logs

If you want to keep track what the extension is doing, just check this. And of course, if you want to report a issue remember to include the logs to make it easy to fix. 

```bash
journalctl -f /usr/bin/gnome-shell | grep '\[IconMatcher\]'
```

## How it does?

This fix your applications on demand whenever a new window is created without a right desktop entry associated to it. It uses a extension privellege for searching apps and windows and its information. It tries to match by a desktop entry that the algorithm thinks is the "100% right one" and fix the desktop file (kinda). What happens its not "100% the right one"? Well sometimes we dont need to be right just close enough is okay. In another words, the algorithm will try to heuristically resolves your desktop entry by scoring all availables based on some window meatada (title, wmclass and appid if available) and after that if someone is close enough, we match to it.


### Did it mess with your desktop entries?

No, the extension by default does not override any desktop entry on your computer. It only creates a new file inside the applications path (~/.local/share/applications/icons-matched) that mirrors the original except by the fixed StartupWMClass. Also it will have a NoDisplay=true to avoid duplication on app menus. Its important to say we can delete this folder created by the extension in order undo everything if something goes wrong. On the future you will be able to override if you want to make it more permanent.


### Did it impact the computer performance?

I dont think so but its hard check how much resources has been spent on this tasks since the extension resources blends with gnome shell. I, personally, dont feel any impact on my computer but if you feel that something is off with the extension, just report it.

### Did it was created by AI?

If the question is "Did you use AI?" the answer is yes. But if the question is "Did the AI make all code?" No, I did my own code, all heuristic algorithm was created outside a gnome extension environment and tested against an array mocked based on my own set of apps, and with those mocked values I tested which score makes more sense and if it should stack between weak asserts and etc. Why did I use AI? Creating extensions on gnome is not hard since everything is js, but to find the right documentation and the right type, well, this is the real challenge. 

### Is it stable?

I tested on my personal use case and another few computers and everything looks fine. There is no unmatched app that should be matched and no matched app that should not be matched. All problems for now I fixed using the heuristic algorithm or some guards that avoid a very specific case in order to save your time debugging. But it could not work if the window does not have enough information to match or if some rule work unexpectdly on your use case. But even with a bad behavior you can only delete the folder and resets what the extension did to you. In the future I will try to make you able to blacklist some wmclass to avoid missmatch. Also I will improve the rules and scoring as long as the problems is being reported.


## Known Issues

Its not exactly a issue, but if the window does not have enough information its simple unfixable without manual intervantion. A good example is the game "Nobody saves the world" that does not have a wmclass trustable neither a good title (the title is only "Game").

## Future Improvements

User settings for better control.

A reset button to delete every auto generated desktop entry.

A blacklist for wmclass

A better way to view what did not match (Currently only with logs)

Improve on rules (if necessary)

