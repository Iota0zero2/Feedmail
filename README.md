# Feed Mail (v0.5)

A Chrome extension that shows your own x.com home timeline in a mail-client layout.

## Install

1. Unzip the folder.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped `feedmail-ext` folder.
4. Open https://x.com/home (reload the tab if it was already open) while logged in.

## What works

- Home feed as a message list: sender, first line as subject, preview text, small thumbnail.
- Click an item to read the text larger, with images shown big in the reading pane.
- Unread markers (bold blue) clear when you open an item.
- **Focused / Other** button in the ribbon is the image censor. "Focused" means every image is blurred, including the big ones (click a big image to reveal just that one). The choice is remembered. `Alt+Q` toggles it too. Default is censored.
- **Esc** swaps the whole view for a plain empty calendar. Press it again to come back.
- Tab title and icon are changed to "Inbox - Mail" with an envelope.
- Keys are blocked from reaching X while the view is up, so X's one-letter shortcuts (like "l" to like) can't fire on the hidden page.
- Videos are never autoplayed; they show as a "Video" tile.

## New in 0.2: post view with comments

- Clicking a post shows it right away, then loads its replies under it in a "Conversation" section. X's own page is moved to the post behind the overlay (no reload) and the replies are read from there.
- Replies show name, handle, time, text and small images (blurred while "Focused" is on). "Load more replies" scrolls the page behind to fetch more.
- Scrolling the list to the end while a post is open takes X back to the feed first, then loads more posts.
- The extension runs on all of x.com and covers the home feed, post pages, profiles and notifications. Other pages (explore, settings, messages) stay normal.
- After updating, reload the extension in `chrome://extensions` and reload the x.com tab.

## New in 0.3: like and save

- **Like** and **Save** buttons under the post in the reading pane, and small Like / Save links under every reply.
- They press X's own like and bookmark buttons on the page behind the overlay, then show the new state. State is read back from the page, so if the click didn't land, the button flips back by itself.
- Liked posts get a small flag after the subject in the list.
- A reply can only be liked or saved while it is on the page behind. If it has scrolled out, a message asks you to scroll the replies a little and try again.

## New in 0.4: replying

- **Reply** button under the post, and a small Reply link under every comment. It opens a draft box pinned to the bottom of the reading pane, with a line saying exactly who you are replying to.
- Sending takes two clicks: the first turns the button red and says "Confirm: send to @handle", the second sends. It disarms itself after 6 seconds.
- Under the hood it opens X's own reply dialog behind the overlay, checks the dialog is about the post you picked, types your text, presses Post, and waits for X to close the dialog. If anything fails you get a message and your draft stays.
- If X doesn't confirm, the message says the reply may not have been sent. Check on x.com before trying again, so you don't post twice.
- Drafts are kept in memory while the page is open, per post or comment.
- Multi-line replies use paragraph breaks and haven't been tested much yet.
- If a failure leaves X's reply box open behind the overlay, reload the tab.

## New in 0.5: profiles and notifications

- **Profiles:** click a sender's name in the reading pane, or a name in the conversation. You get name, handle, bio, join date, follower / following counts and a list of their posts. Click a post in that list to open it with its comments. Profile pictures and banners are not shown at all, so nothing there needs censoring.
- **Follow:** a Follow button on other people's profiles. Unfollow needs two clicks ("Confirm: unfollow"). Both press X's own buttons and read the result back, with a message if X did not accept it.
- **Notifications:** the Notifications folder on the left lists your notifications (likes, replies, follows...). Click one to open the post or profile it is about. Replies and mentions open as a normal post with their conversation.
- Notification rows are taken from X's text as it is, so the wording is X's. Which post or profile a row opens is the first link inside it.
- While a profile is open, scrolling the list to the end no longer jumps back to the feed unless you scroll the list yourself.
- **Load more posts** at the end of a profile's post list fetches the next batch. The pane keeps its scroll position while posts load.

## Known limits

- It reads the real page underneath, so it can break when X changes its markup. The selectors are in `scrapeArticle()`, `scanProfile()` and `scanNotifications()` in `content.js`.
- Posts appear in the order they were first seen, so new posts that X inserts at the top land at the bottom of the list for now.
- The search box and the Liked and Bookmarks folders are placeholders.
- Unliking was rejected by X in testing, so it is not relied on.
- Planned: dark mode.
