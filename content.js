(() => {
  "use strict";
  if (window.__feedMailLoaded) return;
  window.__feedMailLoaded = true;

  const FAKE_TITLE = "Inbox - Mail";
  const FAKE_ICON =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0f6cbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>'
    );

  const posts = new Map(); // id -> post
  const rows = new Map(); // id -> row element
  let censored = true; // default: images hidden until you choose otherwise
  let lastLoad = 0;
  let scanQueued = false;
  const repliesByPost = new Map(); // parent post id -> Map(reply id -> reply)
  let currentId = null; // post shown in the reading pane
  let convEl = null; // conversation container inside the reading pane
  let likeBtn = null; // action buttons of the post in the reading pane
  let saveBtn = null;
  let toastEl = null;
  let toastTimer = 0;
  let composeTarget = null; // { item, parentId }: who the open draft is replying to
  let sending = false;
  let armed = false; // first click on Send arms it, the second one sends
  let armTimer = 0;
  const drafts = new Map(); // item id -> unsent text
  let pendingOpen = null; // post id to show as soon as its page has loaded
  let mode = "post"; // what the reading pane shows: "post" or "profile"
  let profileHandle = null;
  let profileOpenedAt = 0;
  const profiles = new Map(); // lower-case handle -> profile data
  const notifs = new Map(); // key -> notification
  const STATUS_RE = /^\/([^/]+)\/status\/(\d+)/;

  const RESERVED = new Set([
    "home", "explore", "notifications", "messages", "i", "settings", "search", "compose",
    "login", "logout", "signup", "tos", "privacy", "jobs", "hashtag", "intent", "share", "account", "download",
  ]);

  function routeInfo() {
    const path = location.pathname;
    if (path === "/home") return { kind: "home" };
    if (path === "/notifications") return { kind: "notifications" };
    const m = path.match(STATUS_RE);
    if (m) return { kind: "status", handle: m[1], id: m[2] };
    const pm = path.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (pm && !RESERVED.has(pm[1].toLowerCase())) return { kind: "profile", handle: pm[1] };
    return { kind: "other" };
  }

  // Moves X's own page to another route without a reload (X's router listens for popstate).
  function navigate(path) {
    if (location.pathname === path) return;
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }

  // ---------- helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text; // never innerHTML with scraped text
    return n;
  }

  function imageUrl(src, name) {
    try {
      const u = new URL(src);
      if (u.hostname !== "pbs.twimg.com") return null;
      u.searchParams.set("name", name);
      return u.toString();
    } catch {
      return null;
    }
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const now = new Date();
    if (d.toDateString() === now.toDateString())
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if ((now - d) / 864e5 < 7) return d.toLocaleDateString([], { weekday: "short" });
    return d.toLocaleDateString([], { day: "2-digit", month: "short" });
  }

  function fullDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function initials(name) {
    const s = name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => Array.from(w)[0] || "")
      .join("")
      .toUpperCase();
    return s || "?";
  }

  // ---------- reading the page ----------
  function scrapeArticle(a) {
    if (a.querySelector('[data-testid="placementTracking"]')) return null; // ads

    const timeEl = a.querySelector("time");
    const link = timeEl && timeEl.closest("a");
    const href = link && link.getAttribute("href");
    const m = href && href.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!m) return null;

    const textEl = a.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText.trim() : "";

    const images = [];
    a.querySelectorAll('[data-testid="tweetPhoto"] img').forEach((img) => {
      const thumb = imageUrl(img.src, "small");
      const full = imageUrl(img.src, "large");
      if (thumb && full) images.push({ thumb, full });
    });
    const hasVideo = !!a.querySelector('[data-testid="videoPlayer"], video');

    // Still hydrating? Try again on the next scan.
    if (!text && !images.length && !hasVideo) return null;

    const userBlock = a.querySelector('[data-testid="User-Name"]');
    const nameSpan = userBlock && userBlock.querySelector("span");
    const name = (nameSpan && nameSpan.textContent.trim()) || m[1];

    const flat = text.replace(/\s+/g, " ").trim();
    const subject = flat.length > 80 ? flat.slice(0, 80) + "…" : flat || (hasVideo ? "(video)" : "(image)");

    return {
      id: m[2],
      handle: "@" + m[1],
      handleRaw: m[1],
      name,
      iso: timeEl.getAttribute("datetime") || "",
      text,
      subject,
      preview: flat.length > 80 ? flat.slice(80, 300) : "",
      images,
      hasVideo,
      liked: !!a.querySelector('[data-testid="unlike"]'),
      saved: !!a.querySelector('[data-testid="removeBookmark"]'),
    };
  }

  function scan() {
    const route = routeInfo();
    const articles = document.querySelectorAll('article[data-testid="tweet"]');

    if (route.kind === "home") {
      articles.forEach((a) => {
        const p = scrapeArticle(a);
        if (!p) return;
        if (!rows.has(p.id)) {
          if (!posts.has(p.id)) posts.set(p.id, p);
          addRow(posts.get(p.id));
        } else {
          syncFlags(posts.get(p.id), p);
        }
      });
    } else if (route.kind === "status") {
      let bucket = repliesByPost.get(route.id);
      if (!bucket) {
        bucket = new Map();
        repliesByPost.set(route.id, bucket);
      }
      let dirty = false;
      articles.forEach((a) => {
        const p = scrapeArticle(a);
        if (!p) return;
        if (p.id === route.id) {
          // The post itself: the status page has the full text and all images.
          const known = posts.get(p.id);
          if (!known) {
            posts.set(p.id, p);
            if (pendingOpen === p.id) {
              pendingOpen = null; // opened from a notification: no row in the Home list
              show(p.id);
            } else {
              addRow(p);
              if (!currentId) show(p.id);
            }
          } else {
            if (p.text.length > known.text.length || p.images.length > known.images.length) {
              known.text = p.text;
              known.images = p.images;
              known.hasVideo = p.hasVideo;
              if (currentId === p.id) show(p.id, true);
            }
            syncFlags(known, p);
          }
        } else if (bucket.has(p.id)) {
          syncFlags(bucket.get(p.id), p);
        } else if (bucket.size < 80) {
          bucket.set(p.id, p);
          if (currentId === route.id) dirty = true;
        }
      });
      if (dirty) renderConversation();
    } else if (route.kind === "profile") {
      scanProfile(route.handle, articles);
    } else if (route.kind === "notifications") {
      scanNotifications();
    }
    emptyEl.hidden = posts.size > 0;
  }

  // ---------- UI ----------
  const root = el("div");
  root.id = "fm-root";
  root.hidden = true;

  // Title bar
  const titlebar = el("div", "fm-titlebar");
  const brand = el("div", "fm-brand");
  brand.insertAdjacentHTML(
    "beforeend",
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 7l9 6 9-6"></path></svg>'
  );
  brand.append(el("span", "", "Mail"));
  const search = el("input", "fm-search");
  search.type = "text";
  search.placeholder = "Search";
  search.setAttribute("aria-label", "Search");
  titlebar.append(brand, search, el("div", "fm-spacer"), el("div", "fm-me", "ME"));

  // Ribbon (the censor switch is disguised as the "Focused / Other" toggle)
  const ribbon = el("div", "fm-ribbon");
  const tabs = el("div", "fm-tabs");
  const tabHome = el("button", "fm-tab fm-active", "Home");
  tabHome.type = "button";
  tabs.append(tabHome);
  const commands = el("div", "fm-commands");
  const censorBtn = el("button", "fm-pill");
  censorBtn.type = "button";
  censorBtn.addEventListener("click", () => setCensor(!censored, true));
  commands.append(censorBtn);
  ribbon.append(tabs, commands);

  // Panes
  const panes = el("div", "fm-panes");

  const folders = el("nav", "fm-folders");
  folders.setAttribute("aria-label", "Folders");
  function folder(label, onClick) {
    const b = el("button", "fm-folder");
    b.type = "button";
    b.append(el("span", "", label));
    if (onClick) {
      b.addEventListener("click", onClick);
    } else {
      b.disabled = true;
      b.title = "Not built yet";
    }
    return b;
  }
  const unreadBadge = el("span", "fm-folder-n", "");
  const homeFolder = folder("Home", () => navigate("/home"));
  homeFolder.classList.add("fm-active");
  homeFolder.append(unreadBadge);
  const notifFolder = folder("Notifications", () => navigate("/notifications"));
  folders.append(
    el("div", "fm-folder-h", "Favorites"),
    homeFolder,
    notifFolder,
    folder("Liked"),
    folder("Bookmarks")
  );

  const listWrap = el("section", "fm-listwrap");
  listWrap.setAttribute("aria-label", "Message list");
  const list = el("div", "fm-list");
  const emptyEl = el("div", "fm-empty", "Loading your timeline…");
  list.append(emptyEl);
  const notifList = el("div", "fm-list");
  notifList.hidden = true;
  const notifEmpty = el("div", "fm-empty", "Loading notifications…");
  notifList.append(notifEmpty);
  const notifRows = [];
  const listHead = el("div", "fm-listhead", "Home");
  listWrap.append(listHead, list, notifList);

  const reading = el("article", "fm-reading");
  reading.setAttribute("aria-label", "Reading pane");
  const readingInner = el("div", "fm-reading-inner");
  readingInner.append(el("div", "fm-note", "Select an item to read it."));
  reading.append(readingInner);

  // Draft box, pinned to the bottom of the reading pane
  const compose = el("div", "fm-compose");
  compose.hidden = true;
  const composeTo = el("div", "fm-compose-to");
  const composeText = el("textarea", "fm-compose-text");
  composeText.rows = 3;
  composeText.setAttribute("aria-label", "Reply text");
  const composeCount = el("span", "fm-meta", "0 characters");
  const discardBtn = el("button", "fm-pill", "Discard");
  discardBtn.type = "button";
  const sendBtn = el("button", "fm-pill fm-send", "Send");
  sendBtn.type = "button";
  const composeRow = el("div", "fm-compose-row");
  composeRow.append(composeCount, el("div", "fm-spacer"), discardBtn, sendBtn);
  compose.append(composeTo, composeText, composeRow);
  reading.append(compose);

  composeText.addEventListener("input", () => {
    disarm();
    updateCount();
    if (composeTarget) drafts.set(composeTarget.item.id, composeText.value);
  });
  discardBtn.addEventListener("click", () => {
    if (composeTarget) drafts.delete(composeTarget.item.id);
    composeText.value = "";
    closeCompose();
  });
  sendBtn.addEventListener("click", () => {
    const text = composeText.value.trim();
    if (!composeTarget || !text || sending) return;
    if (!armed) {
      armed = true;
      sendBtn.textContent = "Confirm: send to " + composeTarget.item.handle;
      sendBtn.classList.add("fm-armed");
      armTimer = setTimeout(disarm, 6000);
      return;
    }
    disarm();
    sendReply(composeTarget, text);
  });

  panes.append(folders, listWrap, reading);

  const fake = el("div", "fm-fake");
  fake.append(el("div", "", "Calendar"), el("div", "", "You have no events today."));

  root.append(titlebar, ribbon, panes, fake);
  document.documentElement.append(root);

  function addRow(p) {
    const row = el("button", "fm-row fm-unread");
    if (p.liked) row.classList.add("fm-liked");
    row.type = "button";
    const main = el("div", "fm-row-main");
    const top = el("div", "fm-row-top");
    top.append(el("span", "fm-name", p.name), el("span", "fm-time", formatTime(p.iso)));
    main.append(top, el("div", "fm-subject", p.subject));
    if (p.preview) main.append(el("div", "fm-preview", p.preview));
    row.append(main);

    if (p.images.length) {
      const t = el("div", "fm-thumb fm-img");
      const img = document.createElement("img");
      img.src = p.images[0].thumb;
      img.alt = "";
      img.loading = "lazy";
      t.append(img);
      if (p.images.length > 1) t.append(el("span", "fm-count", "+" + (p.images.length - 1)));
      row.append(t);
    } else if (p.hasVideo) {
      row.append(el("div", "fm-thumb fm-video", "Video")); // no autoplay, no preview frame
    }

    row.addEventListener("click", () => {
      show(p.id);
      navigate("/" + encodeURIComponent(p.handleRaw) + "/status/" + p.id); // loads the replies behind the overlay
    });
    list.append(row);
    rows.set(p.id, row);
    updateUnread();
  }

  function updateUnread() {
    let n = 0;
    rows.forEach((r) => {
      if (r.classList.contains("fm-unread")) n++;
    });
    unreadBadge.textContent = n ? String(n) : "";
  }

  function show(id, keep) {
    const p = posts.get(id);
    if (!p) return;
    currentId = id;
    mode = "post";
    profileHandle = null;
    if (composeTarget && composeTarget.parentId !== id) closeCompose(); // the draft text stays saved
    rows.forEach((r, k) => {
      r.classList.toggle("fm-selected", k === id);
      if (k === id) r.classList.remove("fm-unread");
    });
    updateUnread();

    readingInner.replaceChildren();
    const head = el("div", "fm-head");
    const who = el("div", "");
    const fromBtn = el("button", "fm-from fm-link", p.name + "  <" + p.handle + ">");
    fromBtn.type = "button";
    fromBtn.title = "Open profile";
    fromBtn.addEventListener("click", () => openProfile(p.handleRaw));
    who.append(
      fromBtn,
      el("div", "fm-meta", "To: You · " + fullDate(p.iso))
    );
    head.append(el("div", "fm-avatar", initials(p.name)), who);

    const actions = el("div", "fm-actions");
    likeBtn = el("button", "fm-pill");
    saveBtn = el("button", "fm-pill");
    likeBtn.type = "button";
    saveBtn.type = "button";
    likeBtn.addEventListener("click", () => toggle("like", p));
    saveBtn.addEventListener("click", () => toggle("save", p));
    const replyBtn = el("button", "fm-pill", "Reply");
    replyBtn.type = "button";
    replyBtn.addEventListener("click", () => openCompose(p, id));
    actions.append(replyBtn, likeBtn, saveBtn);
    p.paint = paintActions;
    paintActions();
    readingInner.append(head, actions, el("div", "fm-body", p.text || "(no text)"));

    p.images.forEach((i) => {
      const f = el("button", "fm-big fm-img");
      f.type = "button";
      f.setAttribute("aria-label", "Show or hide image");
      const img = document.createElement("img");
      img.src = i.full;
      img.alt = "";
      f.append(img);
      f.addEventListener("click", () => f.classList.toggle("fm-reveal"));
      readingInner.append(f);
    });
    if (p.hasVideo) readingInner.append(el("div", "fm-note", "This post has a video. Open the original to watch it."));

    const open = el("a", "fm-open", "Open original");
    open.href = "https://x.com/" + encodeURIComponent(p.handleRaw) + "/status/" + p.id;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    readingInner.append(open);

    convEl = el("div", "fm-conv");
    readingInner.append(convEl);
    renderConversation();
    setTimeout(() => {
      if (currentId === id) renderConversation(); // swaps "Loading" for "No replies found" if nothing came in
    }, 6500);
    if (!keep) reading.scrollTop = 0;
  }

  let convShownAt = 0;
  function renderConversation() {
    if (!convEl || !currentId) return;
    if (!convEl.dataset.id || convEl.dataset.id !== currentId) {
      convEl.dataset.id = currentId;
      convShownAt = Date.now();
    }
    const bucket = repliesByPost.get(currentId);
    const items = bucket ? Array.from(bucket.values()) : [];

    convEl.replaceChildren();
    convEl.append(el("div", "fm-conv-h", "Conversation" + (items.length ? " (" + items.length + ")" : "")));
    if (!items.length) {
      convEl.append(el("div", "fm-note", Date.now() - convShownAt > 6000 ? "No replies found." : "Loading replies…"));
      return;
    }
    items.forEach((r) => convEl.append(replyEl(r)));

    const more = el("button", "fm-pill fm-more", "Load more replies");
    more.type = "button";
    more.addEventListener("click", () => {
      if (routeInfo().kind === "status") window.scrollTo(0, document.documentElement.scrollHeight);
    });
    convEl.append(more);
  }

  // ---------- profiles ----------
  function openProfile(handleRaw) {
    mode = "profile";
    profileHandle = handleRaw;
    profileOpenedAt = Date.now();
    if (composeTarget) closeCompose();
    reading.scrollTop = 0;
    renderProfile(true);
    navigate("/" + encodeURIComponent(handleRaw));
    setTimeout(scan, 80); // in case the page was already on this profile
  }

  function scanProfile(handle, articles) {
    const col = document.querySelector('[data-testid="primaryColumn"]');
    const un = col && col.querySelector('[data-testid="UserName"]');
    if (!un) return;
    const lower = handle.toLowerCase();
    if (!norm(un.innerText).toLowerCase().includes("@" + lower)) return; // page still showing something else

    let prof = profiles.get(lower);
    if (!prof) {
      prof = { handle, name: handle, bio: "", joined: "", followers: "", following: "", canFollow: false, isFollowing: false, posts: new Map(), sig: "" };
      profiles.set(lower, prof);
    }
    const nameSpan = un.querySelector("span");
    prof.name = (nameSpan && nameSpan.textContent.trim()) || handle;
    const bio = col.querySelector('[data-testid="UserDescription"]');
    prof.bio = bio ? bio.innerText.trim() : "";
    const jd = col.querySelector('[data-testid="UserJoinDate"]');
    prof.joined = jd ? norm(jd.innerText) : "";

    const countOf = (tails) => {
      for (const a of col.querySelectorAll("a[href]")) {
        const h = (a.getAttribute("href") || "").toLowerCase();
        if (tails.some((t) => h === "/" + lower + t)) return norm(a.innerText);
      }
      return "";
    };
    prof.followers = countOf(["/verified_followers", "/followers"]);
    prof.following = countOf(["/following"]);

    const fb = col.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
    prof.canFollow = !!fb;
    prof.isFollowing = !!fb && /-unfollow$/.test(fb.getAttribute("data-testid") || "");

    articles.forEach((a) => {
      const p = scrapeArticle(a);
      if (!p) return;
      if (!posts.has(p.id)) posts.set(p.id, p);
      else syncFlags(posts.get(p.id), p);
      prof.posts.set(p.id, posts.get(p.id));
    });

    const sig = [prof.name, prof.bio, prof.joined, prof.followers, prof.following, prof.canFollow, prof.isFollowing, prof.posts.size].join("|");
    if (sig !== prof.sig) {
      prof.sig = sig;
      if (mode === "profile" && profileHandle && profileHandle.toLowerCase() === lower) renderProfile(true);
    }
  }

  function renderProfile(keepScroll) {
    if (mode !== "profile" || !profileHandle) return;
    const prof = profiles.get(profileHandle.toLowerCase());
    currentId = null;
    likeBtn = saveBtn = convEl = null;
    rows.forEach((r) => r.classList.remove("fm-selected"));
    readingInner.replaceChildren();
    if (!prof) {
      const waited = Date.now() - profileOpenedAt;
      readingInner.append(el("div", "fm-note", waited > 8000 ? "Could not load this profile." : "Loading profile of @" + profileHandle + "…"));
      return;
    }

    const head = el("div", "fm-head");
    const who = el("div", "");
    who.append(el("div", "fm-from", prof.name), el("div", "fm-meta", "@" + prof.handle));
    head.append(el("div", "fm-avatar", initials(prof.name)), who);
    readingInner.append(head);

    const actions = el("div", "fm-actions");
    if (prof.canFollow) {
      const fbtn = el("button", "fm-pill", prof.isFollowing ? "Following" : "Follow");
      fbtn.type = "button";
      fbtn.setAttribute("aria-pressed", String(prof.isFollowing));
      let armed = false;
      fbtn.addEventListener("click", async () => {
        if (prof.isFollowing && !armed) {
          armed = true;
          fbtn.textContent = "Confirm: unfollow";
          fbtn.classList.add("fm-danger");
          setTimeout(() => {
            if (!fbtn.isConnected) return;
            armed = false;
            fbtn.textContent = "Following";
            fbtn.classList.remove("fm-danger");
          }, 5000);
          return;
        }
        fbtn.disabled = true;
        await toggleFollow(prof);
      });
      actions.append(fbtn);
    }
    const open = el("a", "fm-open", "Open on x.com");
    open.href = "https://x.com/" + encodeURIComponent(prof.handle);
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    actions.append(open);
    readingInner.append(actions);

    if (prof.bio) readingInner.append(el("div", "fm-body", prof.bio));
    const bits = [prof.joined, prof.followers, prof.following].filter(Boolean);
    if (bits.length) readingInner.append(el("div", "fm-meta", bits.join("  ·  ")));

    const wrap = el("div", "fm-conv");
    const items = Array.from(prof.posts.values());
    wrap.append(el("div", "fm-conv-h", "Posts" + (items.length ? " (" + items.length + ")" : "")));
    if (!items.length) wrap.append(el("div", "fm-note", "Loading posts…"));
    items.forEach((p) => {
      const b = el("button", "fm-prow");
      b.type = "button";
      const m = el("div", "fm-row-main");
      const t = el("div", "fm-row-top");
      t.append(el("span", "fm-name", p.name), el("span", "fm-time", formatTime(p.iso)));
      m.append(t, el("div", "fm-subject", p.subject));
      if (p.preview) m.append(el("div", "fm-preview", p.preview));
      b.append(m);
      if (p.images.length) {
        const th = el("div", "fm-thumb fm-img");
        const img = document.createElement("img");
        img.src = p.images[0].thumb;
        img.alt = "";
        img.loading = "lazy";
        th.append(img);
        b.append(th);
      } else if (p.hasVideo) {
        b.append(el("div", "fm-thumb fm-video", "Video"));
      }
      b.addEventListener("click", () => {
        show(p.id);
        navigate(postPath(p));
      });
      wrap.append(b);
    });
    if (items.length) {
      const more = el("button", "fm-pill fm-more", "Load more posts");
      more.type = "button";
      more.addEventListener("click", () => {
        if (routeInfo().kind === "profile") window.scrollTo(0, document.documentElement.scrollHeight);
      });
      wrap.append(more);
    }
    readingInner.append(wrap);
    if (!keepScroll) reading.scrollTop = 0;
  }

  async function toggleFollow(prof) {
    const col = document.querySelector('[data-testid="primaryColumn"]');
    const fb = col && col.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
    if (!fb) {
      toast("The follow button is not on the page right now. Nothing changed.");
      renderProfile();
      return;
    }
    const was = /-unfollow$/.test(fb.getAttribute("data-testid") || "");
    fb.click();
    if (was) {
      const ok = await waitFor(() => document.querySelector('[data-testid="confirmationSheetConfirm"]'), 3000);
      if (!ok) {
        toast("X did not ask to confirm the unfollow. Nothing changed.");
        renderProfile();
        return;
      }
      ok.click();
    }
    await sleep(1500);
    const col2 = document.querySelector('[data-testid="primaryColumn"]');
    const fb2 = col2 && col2.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
    const now = !!fb2 && /-unfollow$/.test(fb2.getAttribute("data-testid") || "");
    prof.isFollowing = now;
    if (now === was) toast("X did not accept that change.");
    else toast(was ? "Unfollowed." : "Now following (or request sent).");
    renderProfile();
  }

  // ---------- notifications ----------
  function addNotifRow(n) {
    const row = el("button", "fm-row fm-unread");
    row.type = "button";
    const main = el("div", "fm-row-main");
    const top = el("div", "fm-row-top");
    top.append(el("span", "fm-name", n.title), el("span", "fm-time", n.iso ? formatTime(n.iso) : ""));
    main.append(top, el("div", "fm-subject", n.subject));
    if (n.preview) main.append(el("div", "fm-preview", n.preview));
    row.append(main);
    row.addEventListener("click", () => openNotif(n, row));
    notifList.append(row);
    notifRows.push(row);
  }

  function openNotif(n, row) {
    row.classList.remove("fm-unread");
    notifRows.forEach((r) => r.classList.remove("fm-selected"));
    row.classList.add("fm-selected");
    const sm = n.path && n.path.match(STATUS_RE);
    if (sm) {
      mode = "post";
      if (posts.has(sm[2])) {
        show(sm[2]);
      } else {
        pendingOpen = sm[2];
        readingInner.replaceChildren(el("div", "fm-note", "Loading…"));
      }
      navigate(n.path);
      setTimeout(scan, 80);
      return;
    }
    const pm = n.path && n.path.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (pm) openProfile(pm[1]);
    else toast("This notification has no post or profile to open.");
  }

  function scanNotifications() {
    document.querySelectorAll('article[data-testid="notification"], article[data-testid="tweet"]').forEach((a) => {
      let n = null;
      if (a.getAttribute("data-testid") === "tweet") {
        const p = scrapeArticle(a);
        if (!p) return;
        if (!posts.has(p.id)) posts.set(p.id, p);
        n = { key: "p" + p.id, title: p.name, subject: p.subject, preview: p.preview, iso: p.iso, path: postPath(p) };
      } else {
        const lines = (a.innerText || "").split("\n").map(norm).filter(Boolean);
        if (!lines.length) return;
        const t = a.querySelector("time");
        const iso = t ? t.getAttribute("datetime") || "" : "";
        let status = "";
        let profile = "";
        a.querySelectorAll("a[href]").forEach((l) => {
          const h = l.getAttribute("href") || "";
          if (!status && STATUS_RE.test(h)) status = h.match(STATUS_RE)[0];
          else if (!profile && /^\/[A-Za-z0-9_]{1,15}$/.test(h) && !RESERVED.has(h.slice(1).toLowerCase())) profile = h;
        });
        const subject = lines.slice(0, 3).join(" · ");
        n = {
          key: "n" + lines.slice(0, 3).join("|") + iso,
          title: lines[0],
          subject: subject.length > 100 ? subject.slice(0, 100) + "…" : subject,
          preview: lines.slice(3).join(" ").slice(0, 200),
          iso,
          path: status || profile,
        };
      }
      if (notifs.has(n.key)) return;
      notifs.set(n.key, n);
      addNotifRow(n);
    });
    notifEmpty.hidden = notifs.size > 0;
  }

  // ---------- like and save (these press X's own buttons on the page behind the overlay) ----------
  function postPath(p) {
    return "/" + encodeURIComponent(p.handleRaw) + "/status/" + p.id;
  }

  function findArticle(id) {
    for (const a of document.querySelectorAll('article[data-testid="tweet"]')) {
      const t = a.querySelector("time");
      const link = t && t.closest("a");
      const m = link && (link.getAttribute("href") || "").match(STATUS_RE);
      if (m && m[2] === id) return a;
    }
    return null;
  }

  function toast(msg) {
    if (!toastEl) {
      toastEl = el("div", "fm-toast");
      toastEl.setAttribute("role", "status");
      root.append(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 3500);
  }

  function paintActions() {
    const p = posts.get(currentId);
    if (!p || !likeBtn || !saveBtn) return;
    likeBtn.textContent = p.liked ? "Liked" : "Like";
    likeBtn.setAttribute("aria-pressed", String(!!p.liked));
    saveBtn.textContent = p.saved ? "Saved" : "Save";
    saveBtn.setAttribute("aria-pressed", String(!!p.saved));
  }

  // Copies the real liked/saved state from the page into our copy of the item.
  function syncFlags(known, fresh) {
    if (known.pendingUntil && Date.now() < known.pendingUntil) return; // a click is still settling
    if (known.liked === fresh.liked && known.saved === fresh.saved) return;
    known.liked = fresh.liked;
    known.saved = fresh.saved;
    const row = rows.get(known.id);
    if (row) row.classList.toggle("fm-liked", !!known.liked);
    if (known.paint) known.paint();
  }

  function toggle(kind, item, retried) {
    const a = findArticle(item.id);
    const sel =
      kind === "like"
        ? '[data-testid="like"], [data-testid="unlike"]'
        : '[data-testid="bookmark"], [data-testid="removeBookmark"]';
    const btn = a && a.querySelector(sel);
    if (!btn) {
      const cur = posts.get(currentId);
      const route = routeInfo();
      if (!retried && cur && !(route.kind === "status" && route.id === currentId)) {
        navigate(postPath(cur)); // bring the post's page back, then try once more
        setTimeout(() => toggle(kind, item, true), 1300);
      } else {
        toast("That item is not on the page right now. Scroll the replies a little and try again.");
      }
      return;
    }
    btn.click();
    if (kind === "like") item.liked = !item.liked;
    else item.saved = !item.saved;
    if (item.paint) item.paint();
    const row = rows.get(item.id);
    if (row) row.classList.toggle("fm-liked", !!item.liked);

    // Give X a moment, then read the real state back. If X refused the change
    // (rate limit, server error), say so instead of pretending it worked.
    const want = kind === "like" ? !!item.liked : !!item.saved;
    item.pendingUntil = Date.now() + 1500;
    setTimeout(() => {
      item.pendingUntil = 0;
      const art = findArticle(item.id);
      const fresh = art && scrapeArticle(art);
      if (!fresh) return;
      const real = kind === "like" ? fresh.liked : fresh.saved;
      if (real !== want) {
        toast("X did not accept that " + kind + " change. Showing the real state.");
      }
      syncFlags(item, fresh);
    }, 1500);
  }

  // ---------- replying (drives X's own reply dialog behind the overlay) ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function waitFor(fn, ms) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function tick() {
        const v = fn();
        if (v) return resolve(v);
        if (Date.now() - t0 > ms) return resolve(null);
        setTimeout(tick, 100);
      })();
    });
  }

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

  function updateCount() {
    composeCount.textContent = composeText.value.length + " characters";
  }

  function disarm() {
    armed = false;
    clearTimeout(armTimer);
    sendBtn.textContent = "Send";
    sendBtn.classList.remove("fm-armed");
  }

  function setBusy(b) {
    sendBtn.disabled = b;
    discardBtn.disabled = b;
    composeText.disabled = b;
    if (b) sendBtn.textContent = "Sending…";
    else disarm();
  }

  function openCompose(item, parentId) {
    composeTarget = { item, parentId };
    composeTo.replaceChildren();
    composeTo.append(
      el("span", "", "Replying to "),
      el("strong", "", item.name + " (" + item.handle + ")"),
      el("span", "", ": " + item.subject)
    );
    composeText.value = drafts.get(item.id) || "";
    disarm();
    updateCount();
    compose.hidden = false;
    composeText.focus();
  }

  function closeCompose() {
    composeTarget = null;
    disarm();
    compose.hidden = true;
  }

  function closeXDialog(dlg) {
    const x = dlg && dlg.querySelector('[data-testid="app-bar-close"]');
    if (x) x.click();
  }

  async function sendReply(target, text) {
    if (sending) return;
    sending = true;
    setBusy(true);
    const { item, parentId } = target;
    try {
      // 1. Make sure X's page behind us is the post this reply belongs to.
      const parent = posts.get(parentId);
      const route = routeInfo();
      if (parent && !(route.kind === "status" && route.id === parentId)) {
        navigate(postPath(parent));
        await sleep(1500);
      }
      const art = findArticle(item.id);
      if (!art) throw new Error("That item is not on the page right now. Scroll the replies a little and try again.");
      const xReply = art.querySelector('[data-testid="reply"]');
      if (!xReply) throw new Error("Could not find X's reply button.");

      // 2. Open X's reply dialog and check it is really about this item.
      xReply.click();
      const composer = await waitFor(() => document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]'), 4000);
      if (!composer) throw new Error("X's reply box did not open. Nothing was sent.");
      const dlg = composer.closest('[role="dialog"]');
      const sameLink = dlg.querySelector('a[href*="/status/' + item.id + '"]');
      const sameAuthor = norm(dlg.innerText).toLowerCase().includes("@" + item.handleRaw.toLowerCase());
      if (!sameLink && !sameAuthor) {
        closeXDialog(dlg);
        throw new Error("X's reply box was not for the post you picked, so nothing was sent.");
      }

      // 3. Type the text into X's box.
      composer.focus();
      text.split("\n").forEach((line, i) => {
        if (i) document.execCommand("insertParagraph");
        if (line) document.execCommand("insertText", false, line);
      });
      const typed = await waitFor(() => norm(composer.innerText).includes(norm(text).slice(0, 30)), 1500);
      if (!typed) {
        closeXDialog(dlg);
        throw new Error("Could not type into X's reply box. Nothing was sent. If a hidden box stays open, reload the tab.");
      }

      // 4. Press X's Post button once it is ready.
      const postBtn = await waitFor(() => {
        const b = dlg.querySelector('[data-testid="tweetButton"]');
        return b && b.getAttribute("aria-disabled") !== "true" ? b : null;
      }, 3000);
      if (!postBtn) throw new Error("X's Post button stayed disabled. Nothing was sent. If a hidden box stays open, reload the tab.");
      postBtn.click();

      // 5. Wait for X to close the dialog, which it does once the reply went through.
      const closed = await waitFor(() => !document.contains(composer), 8000);
      if (!closed) {
        throw new Error("X did not confirm the reply. It may not have been sent: check on x.com before you try again. Your draft is kept.");
      }
      drafts.delete(item.id);
      composeText.value = "";
      closeCompose();
      toast("Reply sent.");
    } catch (e) {
      toast(e && e.message ? e.message : "Something went wrong. Nothing was sent.");
    } finally {
      sending = false;
      setBusy(false);
    }
  }

  function replyEl(r) {
    const wrap = el("div", "fm-reply");
    wrap.append(el("div", "fm-avatar fm-avatar-s", initials(r.name)));
    const body = el("div", "fm-reply-body");
    const top = el("div", "fm-reply-top");
    const nameBtn = el("button", "fm-reply-name fm-link", r.name);
    nameBtn.type = "button";
    nameBtn.title = "Open profile";
    nameBtn.addEventListener("click", () => openProfile(r.handleRaw));
    top.append(nameBtn, el("span", "fm-meta", r.handle + " · " + formatTime(r.iso)));
    body.append(top);
    if (r.text) body.append(el("div", "fm-reply-text", r.text));
    r.images.slice(0, 4).forEach((i) => {
      const f = el("button", "fm-rimg fm-img");
      f.type = "button";
      f.setAttribute("aria-label", "Show or hide image");
      const img = document.createElement("img");
      img.src = i.thumb;
      img.alt = "";
      img.loading = "lazy";
      f.append(img);
      f.addEventListener("click", () => f.classList.toggle("fm-reveal"));
      body.append(f);
    });
    if (r.hasVideo) body.append(el("div", "fm-note", "This reply has a video."));

    const acts = el("div", "fm-mini-actions");
    const lb = el("button", "fm-mini");
    const sb = el("button", "fm-mini");
    lb.type = "button";
    sb.type = "button";
    r.paint = () => {
      lb.textContent = r.liked ? "Liked" : "Like";
      lb.setAttribute("aria-pressed", String(!!r.liked));
      sb.textContent = r.saved ? "Saved" : "Save";
      sb.setAttribute("aria-pressed", String(!!r.saved));
    };
    lb.addEventListener("click", () => toggle("like", r));
    sb.addEventListener("click", () => toggle("save", r));
    r.paint();
    const rb = el("button", "fm-mini", "Reply");
    rb.type = "button";
    rb.addEventListener("click", () => openCompose(r, currentId));
    acts.append(rb, lb, sb);
    body.append(acts);
    wrap.append(body);
    return wrap;
  }

  // ---------- censor toggle ----------
  const store = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  function setCensor(on, save) {
    censored = on;
    root.classList.toggle("fm-censor", on);
    censorBtn.textContent = on ? "Focused" : "Other";
    censorBtn.setAttribute("aria-pressed", String(on));
    if (save && store) store.set({ censored: on });
  }
  setCensor(true, false);
  if (store) store.get({ censored: true }, (v) => setCensor(!!v.censored, false));

  // ---------- panic view and keys ----------
  function togglePanic() {
    root.classList.toggle("fm-panic");
  }

  // While the overlay is up, keep keystrokes away from X's own shortcuts
  // (for example "l" would like a post on the hidden page underneath).
  function guardKeys(e) {
    if (root.hidden) return;
    if (e.type === "keydown") {
      if (e.key === "Escape") togglePanic();
      else if (e.altKey && e.key.toLowerCase() === "q") setCensor(!censored, true);
    }
    e.stopImmediatePropagation(); // no preventDefault, so typing in our search box still works
  }
  ["keydown", "keyup", "keypress"].forEach((t) => window.addEventListener(t, guardKeys, true));

  // ---------- loading more ----------
  function maybeLoadMore(fromScroll) {
    const kind = routeInfo().kind;
    const active = kind === "notifications" ? notifList : list;
    const nearEnd = active.scrollHeight - active.scrollTop - active.clientHeight < 300;
    const now = Date.now();
    if (root.hidden || !nearEnd || now - lastLoad <= 1500) return;
    if (kind === "status" || kind === "profile") {
      // Only when you scroll the list yourself, so an open profile is never pulled away.
      if (fromScroll === true && posts.size > 3 && rows.size > 3) {
        lastLoad = now;
        navigate("/home"); // back to the feed; the next check loads more posts
      }
    } else {
      lastLoad = now;
      window.scrollTo(0, document.documentElement.scrollHeight); // makes X fetch the next batch
    }
  }
  list.addEventListener("scroll", () => maybeLoadMore(true));
  notifList.addEventListener("scroll", () => maybeLoadMore(true));
  setInterval(maybeLoadMore, 2000);

  // ---------- keep in sync with the page ----------
  const mo = new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    setTimeout(() => {
      scanQueued = false;
      scan();
    }, 300);
  });
  mo.observe(document.body, { childList: true, subtree: true });

  function sync() {
    const kind = routeInfo().kind;
    const on = kind !== "other";
    const inNotifs = kind === "notifications";
    list.hidden = inNotifs;
    notifList.hidden = !inNotifs;
    listHead.textContent = inNotifs ? "Notifications" : "Home";
    homeFolder.classList.toggle("fm-active", !inNotifs);
    notifFolder.classList.toggle("fm-active", inNotifs);
    document.documentElement.classList.toggle("fm-on", on);
    root.hidden = !on;
    if (!on) return;
    if (document.title !== FAKE_TITLE) document.title = FAKE_TITLE;
    const icons = document.querySelectorAll('link[rel~="icon"]');
    if (!icons.length) {
      const l = document.createElement("link");
      l.rel = "icon";
      l.href = FAKE_ICON;
      document.head.append(l);
    }
    icons.forEach((l) => {
      if (l.getAttribute("href") !== FAKE_ICON) l.setAttribute("href", FAKE_ICON);
    });
  }
  setInterval(sync, 500);
  sync();
  scan();
})();
