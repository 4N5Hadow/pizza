import { db, auth, storage } from "./firebase-config.js";
import {
  collection, addDoc, query, orderBy, onSnapshot,
  doc, updateDoc, deleteDoc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB, matches Storage rules

const SUBJECT_CLASS = { DAI: "cap-dai", DSA: "cap-dsa", DLDCA: "cap-dldca", Logic: "cap-logic", Misc: "cap-misc" };

const feedEl = document.getElementById("feed");
const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const tabsEl = document.getElementById("subjectTabs");

let activeSubject = "all";
let activeType = "all";
let allPosts = [];
let isAdmin = false;
let adminName = localStorage.getItem("adminName") || "Mentor";
let currentView = "board"; // "board" | "archive"
let selectedComposerType = "Doubt";

// ---- helpers ----

function hashRotation(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return (h % 5) - 2; // -2deg to 2deg
}

function timeAgo(ts) {
  if (!ts || typeof ts.toDate !== "function") return "recently";
  const seconds = Math.floor((Date.now() - ts.toDate().getTime()) / 1000);
  if (seconds < 60) return "just now";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function uploadImageIfAny(file) {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("Please attach an image file.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Image is too large (5MB max).");
  const path = `doubt-images/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file);
  return getDownloadURL(fileRef);
}

// ---- feed rendering ----

function renderFeed() {
  let posts = allPosts.filter(p =>
    currentView === "archive" ? p.archived === true : p.archived !== true
  );

  if (activeSubject !== "all") {
    posts = posts.filter(p => p.subject === activeSubject);
  }
  if (activeType !== "all") {
    posts = posts.filter(p => (p.type || "Doubt") === activeType);
  }

  if (currentView === "board") {
    posts.sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return 0; // createdAt desc order already applied by the query
    });
  }

  feedEl.innerHTML = "";

  if (posts.length === 0) {
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = currentView === "archive"
      ? "Nothing archived yet."
      : "The board's empty here. Be the first to pin something.";
    return;
  }
  emptyState.hidden = true;

  posts.forEach(post => {
    try {
      if (typeof post.title !== "string" || typeof post.subject !== "string") return; // skip malformed docs

      const card = document.createElement("article");
      card.className = "note" + (post.pinned ? " is-pinned" : "");
      card.style.transform = `rotate(${hashRotation(post.id)}deg)`;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `Open doubt: ${post.title}`);

      card.innerHTML = `
        ${post.pinned ? '<span class="pin-flag" title="Pinned">📌</span>' : ""}
        <div class="note-subject"><span class="cap ${SUBJECT_CLASS[post.subject] || ""}"></span>${escapeHtml(post.subject)}
          <span class="note-type-badge${(post.type || "Doubt") === "Logistics" ? " is-logistics" : ""}">${(post.type || "Doubt")}</span>
        </div>
        ${post.imageUrl ? `<img class="note-image" src="${escapeHtml(post.imageUrl)}" alt="Attached image" loading="lazy">` : ""}
        <h3 class="note-title">${escapeHtml(post.title)}</h3>
        ${post.body ? `<p class="note-body">${escapeHtml(post.body)}</p>` : ""}
        <div class="note-meta"><span>${post.commentCount || 0} replies</span><span>${timeAgo(post.createdAt)}</span></div>
      `;
      card.addEventListener("click", () => openThread(post));
      card.addEventListener("keydown", e => { if (e.key === "Enter") openThread(post); });
      feedEl.appendChild(card);
    } catch (err) {
      console.error("Skipped a malformed post:", post.id, err);
    }
  });
}

function subscribeToFeed() {
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
  onSnapshot(q, snapshot => {
    loadingState.hidden = true;
    allPosts = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFeed();
  }, err => {
    loadingState.textContent = "Couldn't load the board — check your Firebase config in firebase-config.js.";
    console.error(err);
  });
}

// ---- subject tabs ----

const typeFilterEl = document.getElementById("typeFilter");
typeFilterEl.addEventListener("click", e => {
  const btn = e.target.closest(".type-tab");
  if (!btn) return;
  typeFilterEl.querySelectorAll(".type-tab").forEach(t => {
    t.classList.remove("is-active");
    t.setAttribute("aria-pressed", "false");
  });
  btn.classList.add("is-active");
  btn.setAttribute("aria-pressed", "true");
  activeType = btn.dataset.type;
  renderFeed();
});

const viewToggle = document.getElementById("viewToggle");
viewToggle.addEventListener("click", () => {
  currentView = currentView === "board" ? "archive" : "board";
  viewToggle.setAttribute("aria-pressed", currentView === "archive" ? "true" : "false");
  viewToggle.textContent = currentView === "archive" ? "Back to board" : "View archive";
  renderFeed();
});

tabsEl.addEventListener("click", e => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  tabsEl.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-pressed", "false"));
  btn.setAttribute("aria-pressed", "true");
  activeSubject = btn.dataset.subject;
  renderFeed();
});

// ---- composer ----

const modalBackdrop = document.getElementById("modalBackdrop");
const composerError = document.getElementById("composerError");

document.getElementById("openComposer").addEventListener("click", () => {
  modalBackdrop.hidden = false;
  document.getElementById("doubtTitle").focus();
});
document.getElementById("closeComposer").addEventListener("click", () => modalBackdrop.hidden = true);
modalBackdrop.addEventListener("click", e => { if (e.target === modalBackdrop) modalBackdrop.hidden = true; });

const typeSelectEl = document.getElementById("typeSelect");
typeSelectEl.addEventListener("click", e => {
  const btn = e.target.closest(".type-option");
  if (!btn) return;
  typeSelectEl.querySelectorAll(".type-option").forEach(o => {
    o.classList.remove("is-active");
    o.setAttribute("aria-checked", "false");
  });
  btn.classList.add("is-active");
  btn.setAttribute("aria-checked", "true");
  selectedComposerType = btn.dataset.type;
});

document.getElementById("doubtImage").addEventListener("change", e => {
  const file = e.target.files[0];
  const preview = document.getElementById("doubtImagePreview");
  if (!file) { preview.hidden = true; preview.innerHTML = ""; return; }
  preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
  preview.hidden = false;
});

document.getElementById("submitDoubt").addEventListener("click", async () => {
  const subject = document.getElementById("subjectSelect").value;
  const title = document.getElementById("doubtTitle").value.trim();
  const body = document.getElementById("doubtBody").value.trim();
  const imageFile = document.getElementById("doubtImage").files[0];
  composerError.hidden = true;

  if (!title) {
    composerError.textContent = "Give it a one-line summary first.";
    composerError.hidden = false;
    return;
  }

  const submitBtn = document.getElementById("submitDoubt");
  const originalLabel = submitBtn.textContent;

  try {
    let imageUrl = null;
    if (imageFile) {
      submitBtn.textContent = "Uploading image…";
      submitBtn.disabled = true;
      imageUrl = await uploadImageIfAny(imageFile);
    }

    await addDoc(collection(db, "posts"), {
      subject, title, body,
      type: selectedComposerType,
      imageUrl,
      commentCount: 0,
      pinned: false,
      archived: false,
      createdAt: serverTimestamp()
    });
    document.getElementById("doubtTitle").value = "";
    document.getElementById("doubtBody").value = "";
    document.getElementById("doubtImage").value = "";
    document.getElementById("doubtImagePreview").hidden = true;
    document.getElementById("doubtImagePreview").innerHTML = "";
    typeSelectEl.querySelectorAll(".type-option").forEach(o => {
      o.classList.toggle("is-active", o.dataset.type === "Doubt");
      o.setAttribute("aria-checked", o.dataset.type === "Doubt" ? "true" : "false");
    });
    selectedComposerType = "Doubt";
    modalBackdrop.hidden = true;
  } catch (err) {
    composerError.textContent = err.message || "Couldn't post — check your Firebase config and Firestore rules.";
    composerError.hidden = false;
    console.error(err);
  } finally {
    submitBtn.textContent = originalLabel;
    submitBtn.disabled = false;
  }
});

// ---- thread modal ----

const threadBackdrop = document.getElementById("threadBackdrop");
const threadContent = document.getElementById("threadContent");
let unsubscribeComments = null;

const adminThreadActions = document.getElementById("adminThreadActions");

function openThread(post) {
  threadBackdrop.hidden = false;
  threadContent.innerHTML = `
    <div class="thread-subject"><span class="cap ${SUBJECT_CLASS[post.subject] || ""}"></span> ${escapeHtml(post.subject)}
      <span class="note-type-badge${(post.type || "Doubt") === "Logistics" ? " is-logistics" : ""}">${(post.type || "Doubt")}</span>
    </div>
    <h2 class="thread-title">${escapeHtml(post.title)}</h2>
    ${post.imageUrl ? `<img class="thread-image" src="${escapeHtml(post.imageUrl)}" alt="Attached image">` : ""}
    ${post.body ? `<p class="thread-body">${escapeHtml(post.body)}</p>` : ""}
    <div class="comments-list" id="commentsList"></div>
    <label class="field-label" for="commentInput">Add a reply</label>
    ${post.archived ? `<p class="modal-hint">This doubt is archived — replying brings it back to the board.</p>` : ""}
    <textarea id="commentInput" rows="3" maxlength="800" placeholder="Share how you'd approach it…"></textarea>
    <label class="field-label" for="commentImage">Attach an image (optional)</label>
    <input id="commentImage" type="file" accept="image/*">
    <div class="image-preview" id="commentImagePreview" hidden></div>
    <button class="btn-primary" id="submitComment">Reply${isAdmin ? ` as ${escapeHtml(adminName)}` : ""}</button>
    <p class="error-msg" id="commentError" hidden></p>
  `;

  document.getElementById("commentImage").addEventListener("change", e => {
    const file = e.target.files[0];
    const preview = document.getElementById("commentImagePreview");
    if (!file) { preview.hidden = true; preview.innerHTML = ""; return; }
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="Preview">`;
    preview.hidden = false;
  });

  if (isAdmin) {
    adminThreadActions.hidden = false;
    adminThreadActions.innerHTML = `
      <button id="togglePin" class="${post.pinned ? "active" : ""}">${post.pinned ? "📌 Pinned" : "Pin to top"}</button>
      <button id="toggleArchive" class="${post.archived ? "active" : ""}">${post.archived ? "Unarchive" : "Move to archive"}</button>
      <button id="deleteDoubt" class="danger">Delete doubt</button>
    `;
    document.getElementById("togglePin").addEventListener("click", async () => {
      await updateDoc(doc(db, "posts", post.id), { pinned: !post.pinned });
      threadBackdrop.hidden = true;
    });
    document.getElementById("toggleArchive").addEventListener("click", async () => {
      await updateDoc(doc(db, "posts", post.id), { archived: !post.archived });
      threadBackdrop.hidden = true;
    });
    document.getElementById("deleteDoubt").addEventListener("click", async () => {
      if (!confirm("Delete this doubt and all its replies? This can't be undone.")) return;
      if (unsubscribeComments) unsubscribeComments();
      await deleteDoc(doc(db, "posts", post.id));
      threadBackdrop.hidden = true;
    });
  } else {
    adminThreadActions.hidden = true;
    adminThreadActions.innerHTML = "";
  }

  const commentsList = document.getElementById("commentsList");
  const q = query(collection(db, "posts", post.id, "comments"), orderBy("createdAt", "asc"));
  if (unsubscribeComments) unsubscribeComments();
  unsubscribeComments = onSnapshot(q, snapshot => {
    commentsList.innerHTML = "";
    if (snapshot.empty) {
      commentsList.innerHTML = `<p class="comment-meta">No replies yet — be the first to help.</p>`;
      return;
    }
    snapshot.forEach(d => {
      const c = d.data();
      const el = document.createElement("div");
      el.className = "comment" + (c.isAdmin ? " is-admin" : "");
      el.innerHTML = `
        ${isAdmin ? `<button class="comment-delete" data-id="${d.id}" title="Delete reply" aria-label="Delete reply">×</button>` : ""}
        ${escapeHtml(c.body)}
        ${c.imageUrl ? `<img class="comment-image" src="${escapeHtml(c.imageUrl)}" alt="Attached image" loading="lazy">` : ""}
        <div class="comment-meta">${c.isAdmin ? `${escapeHtml(c.author || "Admin")}<span class="admin-badge">Admin</span> · ` : ""}${timeAgo(c.createdAt)}</div>`;
      commentsList.appendChild(el);
    });
    if (isAdmin) {
      commentsList.querySelectorAll(".comment-delete").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this reply?")) return;
          await deleteDoc(doc(db, "posts", post.id, "comments", btn.dataset.id));
          await updateDoc(doc(db, "posts", post.id), { commentCount: increment(-1) });
        });
      });
    }
  });

  document.getElementById("submitComment").addEventListener("click", async () => {
    const input = document.getElementById("commentInput");
    const commentError = document.getElementById("commentError");
    const imageFile = document.getElementById("commentImage").files[0];
    const body = input.value.trim();
    commentError.hidden = true;
    if (!body) {
      commentError.textContent = "Write something before replying.";
      commentError.hidden = false;
      return;
    }
    const submitBtn = document.getElementById("submitComment");
    const originalLabel = submitBtn.textContent;
    try {
      let imageUrl = null;
      if (imageFile) {
        submitBtn.textContent = "Uploading image…";
        submitBtn.disabled = true;
        imageUrl = await uploadImageIfAny(imageFile);
      }
      const commentData = { body, imageUrl, createdAt: serverTimestamp() };
      if (isAdmin) {
        commentData.isAdmin = true;
        commentData.author = adminName;
      }
      await addDoc(collection(db, "posts", post.id, "comments"), commentData);
      const bumpData = { commentCount: increment(1) };
      if (post.archived) {
        bumpData.archived = false;
        post.archived = false; // keep local state in sync if they reply again before closing
      }
      await updateDoc(doc(db, "posts", post.id), bumpData);
      input.value = "";
      document.getElementById("commentImage").value = "";
      document.getElementById("commentImagePreview").hidden = true;
      document.getElementById("commentImagePreview").innerHTML = "";
    } catch (err) {
      commentError.textContent = err.message || "Couldn't post the reply — check Firestore rules.";
      commentError.hidden = false;
      console.error(err);
    } finally {
      submitBtn.textContent = originalLabel;
      submitBtn.disabled = false;
    }
  });
}

document.getElementById("closeThread").addEventListener("click", () => {
  threadBackdrop.hidden = true;
  if (unsubscribeComments) unsubscribeComments();
});
threadBackdrop.addEventListener("click", e => {
  if (e.target === threadBackdrop) {
    threadBackdrop.hidden = true;
    if (unsubscribeComments) unsubscribeComments();
  }
});

// ---- admin auth ----

const adminBackdrop = document.getElementById("adminBackdrop");
const adminError = document.getElementById("adminError");
const adminBarLoggedOut = document.getElementById("adminBarLoggedOut");
const adminBarLoggedIn = document.getElementById("adminBarLoggedIn");
const adminNameLabel = document.getElementById("adminNameLabel");

document.getElementById("openAdminLogin").addEventListener("click", () => {
  document.getElementById("adminName").value = adminName;
  adminBackdrop.hidden = false;
});
document.getElementById("closeAdmin").addEventListener("click", () => adminBackdrop.hidden = true);
adminBackdrop.addEventListener("click", e => { if (e.target === adminBackdrop) adminBackdrop.hidden = true; });

document.getElementById("submitAdminLogin").addEventListener("click", async () => {
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  const name = document.getElementById("adminName").value.trim() || "Mentor";
  adminError.hidden = true;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    adminName = name;
    localStorage.setItem("adminName", name);
    adminBackdrop.hidden = true;
  } catch (err) {
    adminError.textContent = `Couldn't sign in (${err.code || err.message}) — check the email and password.`;
    adminError.hidden = false;
    console.error(err);
  }
});

document.getElementById("adminLogout").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, user => {
  isAdmin = !!user;
  adminBarLoggedOut.hidden = isAdmin;
  adminBarLoggedIn.hidden = !isAdmin;
  if (isAdmin) adminNameLabel.textContent = adminName;
  renderFeed();
});

// ---- theme toggle ----

const themeToggle = document.getElementById("themeToggle");
const savedTheme = localStorage.getItem("theme") || "dark";
applyTheme(savedTheme);

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    themeToggle.textContent = "☀️";
  } else {
    document.documentElement.removeAttribute("data-theme");
    themeToggle.textContent = "🌙";
  }
}

themeToggle.addEventListener("click", () => {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const next = isLight ? "dark" : "light";
  applyTheme(next);
  localStorage.setItem("theme", next);
});

// ---- init ----
subscribeToFeed();
