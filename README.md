# Feed Mail (v0.7.1)

A Chrome extension that shows your own x.com home timeline in a mail-client layout.

## Install

1. Get the files: either `git clone https://github.com/Iota0zero2/Feedmail.git`, or on GitHub click **Code → Download ZIP** and unzip it.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the folder that contains `manifest.json`.
4. Open https://x.com/home (reload the tab if it was already open) while logged in.

To update: get the new files (`git pull`, or download the ZIP again into the same folder), then press the reload icon on Feed Mail in `chrome://extensions` and reload the x.com tab.

## What works

- Home feed as a message list: sender, first line as subject, preview text, small thumbnail.
- Folders for **Home**, **Notifications**, **Liked** and **Bookmarks**, and a **Search** box that filters the list you're looking at.
- Click an item to read the text larger, with images shown big in the reading pane.
- Unread markers (bold blue) clear when you open an item.
- **Focused / Other** button in the ribbon is the image censor. "Focused" means every image is blurred, including the big ones (click a big image to reveal just that one). The choice is remembered. `Alt+Q` (Option+Q on a Mac) toggles it too. Default is censored.
- **Esc** swaps the whole view for a plain empty calendar. Press it again to come back.
- Tab title and icon are changed to "Inbox - Mail" with an envelope.
- Keys are blocked from reaching X while the view is up, so X's one-letter shortcuts (like "l" to like) can't fire on the hidden page.
- Videos are never autoplayed; they show as a "Video" tile.

## Known limits

- It reads the real page underneath, so it can break when X changes its markup. The selectors are in `scrapeArticle()`, `scanProfile()`, `scanNotifications()` and `findMyHandle()` in `content.js`.
- Posts appear in the order they were first seen, so new posts that X inserts at the top land at the bottom of the list for now.
- Search only looks through posts that are already loaded in the list; it doesn't search all of X.

## Version history

Oldest first; the newest version is at the bottom.

### 0.2: post view with comments

- Clicking a post shows it right away, then loads its replies under it in a "Conversation" section. X's own page is moved to the post behind the overlay (no reload) and the replies are read from there.
- Replies show name, handle, time, text and small images (blurred while "Focused" is on). "Load more replies" scrolls the page behind to fetch more.
- Scrolling the list to the end while a post is open takes X back to the feed first, then loads more posts.
- The extension runs on all of x.com and covers the home feed, post pages, profiles and notifications. Other pages (explore, settings, messages) stay normal.
- After updating, reload the extension in `chrome://extensions` and reload the x.com tab.

### 0.3: like and save

- **Like** and **Save** buttons under the post in the reading pane, and small Like / Save links under every reply.
- They press X's own like and bookmark buttons on the page behind the overlay, then show the new state. State is read back from the page, so if the click didn't land, the button flips back by itself.
- Liked posts get a small flag after the subject in the list.
- A reply can only be liked or saved while it is on the page behind. If it has scrolled out, a message asks you to scroll the replies a little and try again.

### 0.4: replying

- **Reply** button under the post, and a small Reply link under every comment. It opens a draft box pinned to the bottom of the reading pane, with a line saying exactly who you are replying to.
- Sending takes two clicks: the first turns the button red and says "Confirm: send to @handle", the second sends. It disarms itself after 6 seconds.
- Under the hood it opens X's own reply dialog behind the overlay, checks the dialog is about the post you picked, types your text, presses Post, and waits for X to close the dialog. If anything fails you get a message and your draft stays.
- If X doesn't confirm, the message says the reply may not have been sent. Check on x.com before trying again, so you don't post twice.
- Drafts are kept in memory while the page is open, per post or comment.
- Multi-line replies use paragraph breaks and haven't been tested much yet.
- If a failure leaves X's reply box open behind the overlay, reload the tab.

### 0.5: profiles and notifications

- **Profiles:** click a sender's name in the reading pane, or a name in the conversation. You get name, handle, bio, join date, follower / following counts and a list of their posts. Click a post in that list to open it with its comments. Profile pictures and banners are not shown at all, so nothing there needs censoring.
- **Follow:** a Follow button on other people's profiles. Unfollow needs two clicks ("Confirm: unfollow"). Both press X's own buttons and read the result back, with a message if X did not accept it.
- **Notifications:** the Notifications folder on the left lists your notifications (likes, replies, follows...). Click one to open the post or profile it is about. Replies and mentions open as a normal post with their conversation.
- Notification rows are taken from X's text as it is, so the wording is X's. Which post or profile a row opens is the first link inside it.
- While a profile is open, scrolling the list to the end no longer jumps back to the feed unless you scroll the list yourself.
- **Load more posts** at the end of a profile's post list fetches the next batch. The pane keeps its scroll position while posts load.

### 0.6: notifications tab and dark mode

- **Notifications tab** in the ribbon, next to Home. It does the same as the Notifications folder on the left, and the tab and folder stay highlighted together.
- The Notifications folder shows how many notifications you haven't opened yet.
- **Dark mode:** the **Theme** button in the ribbon switches between System (follows your computer's light/dark setting, the default), Light and Dark. The choice is remembered. The calendar shown by **Esc** follows the theme too.
- Fixed: `Alt+Q` (Option+Q) did nothing on a Mac, because the Mac turns Option+Q into "œ". It now works on every keyboard layout.
- Fixed: the real X tab title (like "(3) Home / X") could show for up to half a second after moving between pages. The fake title is now put back immediately.
- Fixed: "Loading your timeline…" disappeared from an empty Home list once you had opened a profile or notification.
- The version in `manifest.json` now matches this README (it said 0.1.0 before).

### 0.6.1: unliking works

- **Unlike and unsave now work** from the reading pane and from replies. Earlier versions checked X's button once, 1.5 seconds after the click. When X was slower than that (often the case for unlikes), Feed Mail wrongly said "X did not accept that like change" and flipped the button back, although X had accepted it.
- Feed Mail now keeps checking X's own button for up to 6 seconds, and also copes with X redrawing the post meanwhile.
- Whether a click likes or unlikes is decided by X's button at that moment, not by Feed Mail's possibly out-of-date copy.
- Clicking Like again while the previous click is still going through is ignored, so a quick double click can't send two clicks to X.
- If X really refuses, the message now names what was refused ("X did not accept that unlike") and the button shows the real state.

### 0.7.0: search, Liked and Bookmarks

- **Search** box in the title bar filters the list that is showing (Home, Notifications, Liked or Bookmarks) as you type. It matches the sender's name, their @handle and the post text, ignoring upper/lower case. The list title shows how many match, e.g. "Home · 3 matches". Clear the box to see everything again.
- **Liked** folder lists the posts you have liked. It opens your own likes page on X behind the view, and scrolling to the end loads more, like Home.
- **Bookmarks** folder lists your saved posts the same way.
- Unliking a post in Liked, or unsaving one in Bookmarks, removes it from that list straight away.
- Opening a post or profile now keeps the list you came from on screen. Before, opening a notification switched the list back to Home.
- The Home and Notifications tabs in the ribbon light up only for their own lists; neither is highlighted while you're in Liked or Bookmarks.

### 0.7.1: license and README

- Feed Mail is now under the MIT license (see `LICENSE`), which is included in the download.
- Version history in this README is listed oldest first again.
- No changes to how the extension works.

## License

MIT, see [LICENSE](LICENSE). Feed Mail is not affiliated with X.
