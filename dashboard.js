const SUPABASE_URL = "https://xwawghxsebspjonkxafm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YXdnaHhzZWJzcGpvbmt4YWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0NzE4MDEsImV4cCI6MjEwMzA0NzgwMX0.Qht29UsrW-XXUkXDEqJvw00AHKdnjswNPwRHg78vIz4";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

let projectById = {};
let allShares = [];
let sharedToMe = [];
let allClassmates = [];
let shareTargetId = null;
let shareActiveCount = 0;
let shareDailyCount = 0;
let sharePick = {};
let shareClosed = [];

let simClock = { simulated_at: null, label: null };
function clockNow() { return simClock.simulated_at ? new Date(simClock.simulated_at) : new Date(); }
async function refreshSimClock(){
    try{
        const { data, error } = await supabaseClient.rpc("read_sim_clock");
        if(error) throw error;
        const clock = Array.isArray(data) ? data[0] : data;
        simClock = { simulated_at: clock && clock.simulated_at ? clock.simulated_at : null, label: clock && clock.label ? clock.label : null };
    }catch(e){ simClock={simulated_at:null,label:null}; }
}
function renderDashboardDate() {
    const today = clockNow();
    document.getElementById("todayLabel").textContent = `${today.toLocaleDateString(undefined, { weekday: "long" })} · Lab activity`;
    document.getElementById("currentDate").textContent = today.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}


let inventoryParts = [];
let partCart = {};
let partCategoryOptions = [];
let borrowLogs = [];
let receiptTimer = null;
let activeReceiptId = null;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function initialsFor(name) {
    return name.split(" ").filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "ST";
}

function formatTime(value) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function showToast(message) {
    const toast = document.getElementById("dashboardToast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function partItemCount(loan) {
    const items = Array.isArray(loan.items) ? loan.items : [];
    return items.reduce((total, item) => total + (Number(item.quantity) || 0), 0) || items.length;
}

async function loadOverviewMetrics() {
    if (!currentUser) return;
    const [loansResult, interestsResult] = await Promise.all([
        supabaseClient.from("part_proposals").select("id, due_at, lent_at, returned_at, items").eq("student_id", currentUser.id),
        supabaseClient.from("project_interests").select("project_id").eq("student_id", currentUser.id)
    ]);
    const active = (loansResult.data || []).filter(loan => loan.lent_at && !loan.returned_at);
    const overdue = active.filter(loan => loan.due_at && new Date(loan.due_at).getTime() < clockNow().getTime());
    document.getElementById("partsOnLoanTotal").textContent = active.reduce((total, loan) => total + partItemCount(loan), 0);
    document.getElementById("partsOverdueTotal").textContent = overdue.reduce((total, loan) => total + partItemCount(loan), 0);
    document.getElementById("projectsTakenTotal").textContent = (interestsResult.data || []).length;
}

function showFeedMessage(message, error = false) {
    document.getElementById("postList").innerHTML = `<div class="empty-state ${error ? "empty-state-error" : ""}"><strong>${escapeHtml(error ? "The den is taking a breather." : "No announcements yet")}</strong><p>${escapeHtml(message)}</p></div>`;
}

const openCommentPostIds = new Set();

function renderPosts(posts) {
    if (!posts.length) {
        showFeedMessage("Teacher announcements will appear here as soon as one is shared.");
        return;
    }
    document.getElementById("postList").innerHTML = posts.map(post => {
        const formal = Social.kind(post) === "formal";
        return `
        <article class="post-card ${formal ? "teacher-important" : "informal"}" data-post-id="${escapeHtml(post.id)}">
            <div class="post-meta">
                <div class="post-author-avatar" style="background:${escapeHtml(post.author_color || "#c8f36d")}">${escapeHtml(post.author_initials)}</div>
                <div class="post-author"><strong>${escapeHtml(post.author_name)}</strong><small>${escapeHtml(formatTime(post.created_at))}</small></div>
            </div>
            ${post.body ? `<p>${escapeHtml(post.body)}</p>` : ""}
            ${Social.attachmentHtml(post, escapeHtml)}
            <div class="post-actions">
                <button class="post-action ${post.liked ? "liked" : ""}" data-action="like" type="button">♡ Like ${post.like_count || ""}</button>
                <button class="post-action" data-action="comment" type="button">◌ Comment ${post.comments.length || ""}</button>
                <button class="post-action" data-action="share" type="button">↗ Share</button>
            </div>
            <div class="comments ${openCommentPostIds.has(post.id) ? "open" : ""}" data-comments>
                <div class="comment-list">${post.comments.map(comment => `
                    <div class="comment" data-comment-id="${escapeHtml(comment.id)}">
                        <strong>${escapeHtml(comment.author_name)}:</strong>
                        <span class="comment-text">${escapeHtml(comment.body)}</span>
                        ${comment.author_id === currentUser.id ? `<span class="comment-actions">
                            <button class="comment-action" data-comment-action="edit" type="button" aria-label="Edit your comment">✎</button>
                            <button class="comment-action danger" data-comment-action="delete" type="button" aria-label="Delete your comment">🗑</button>
                        </span>` : ""}
                    </div>`).join("")}</div>
                <form class="comment-form"><input aria-label="Write a comment" maxlength="300" placeholder="Add a thoughtful reply..."><button type="submit">Send</button></form>
            </div>
        </article>`;
    }).join("");
}

async function loadAnnouncements() {
    const { data: announcements, error: announcementsError } = await supabaseClient
        .from("announcements")
        .select("id, author_id, author_name, author_initials, author_color, body, tag, author_role, attachment_url, attachment_type, attachment_name, created_at")
        .order("created_at", { ascending: false });

    if (announcementsError) {
        showFeedMessage("Announcements need the Supabase setup script before they can load.", true);
        console.error("Announcement load error:", announcementsError);
        return;
    }

    if (!announcements.length) {
        renderPosts([]);
        return;
    }

    const ids = announcements.map(announcement => announcement.id);
    const [{ data: likes, error: likesError }, { data: comments, error: commentsError }] = await Promise.all([
        supabaseClient.from("announcement_likes").select("announcement_id, user_id").in("announcement_id", ids),
        supabaseClient.from("announcement_comments").select("id, announcement_id, author_id, author_name, body, created_at").in("announcement_id", ids).order("created_at", { ascending: true })
    ]);

    if (likesError || commentsError) {
        showFeedMessage("We could not load the conversation around these announcements.", true);
        console.error("Announcement interaction load error:", likesError || commentsError);
        return;
    }

    const posts = announcements.map(announcement => {
        const postLikes = likes.filter(like => like.announcement_id === announcement.id);
        return {
            ...announcement,
            like_count: postLikes.length,
            liked: postLikes.some(like => like.user_id === currentUser.id),
            comments: comments.filter(comment => comment.announcement_id === announcement.id)
        };
    });
    renderPosts(posts);
}

async function loadInventoryParts() {
    const { data: parts, error } = await supabaseClient
        .from("inventory_parts")
        .select("id, name, category, quantity, location")
        .order("name", { ascending: true });
    if (error) {
        console.error("Registry load error:", error);
        document.getElementById("partsGrid").innerHTML = `<div class="empty-state empty-state-error"><strong>Registry unavailable</strong><p>Parts could not be loaded.</p></div>`;
        return;
    }
    inventoryParts = parts || [];
    const partMap = new Map(inventoryParts.map(part => [part.id, part]));
    Object.keys(partCart).forEach(id => {
        const fresh = partMap.get(id);
        if (fresh) partCart[id].part = fresh;
        else delete partCart[id];
    });
    partCategoryOptions = [...new Set(inventoryParts.map(part => part.category).filter(Boolean))].sort();
    populateCategoryFilter();
    renderPartsGrid();
    renderCart();
}

function populateCategoryFilter() {
    const select = document.getElementById("partCategoryFilter");
    const current = select.value;
    select.innerHTML = `<option value="">All categories</option>${partCategoryOptions.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
    select.value = current;
}

function visibleParts() {
    const query = document.getElementById("partSearch").value.trim().toLowerCase();
    const category = document.getElementById("partCategoryFilter").value;
    return inventoryParts.filter(part => {
        const matchesQuery = !query || `${part.name} ${part.category} ${part.location}`.toLowerCase().includes(query);
        const matchesCategory = !category || part.category === category;
        return matchesQuery && matchesCategory;
    });
}

function renderPartsGrid() {
    const grid = document.getElementById("partsGrid");
    if (!inventoryParts.length) {
        grid.innerHTML = `<div class="empty-state"><strong>Registry is empty</strong><p>Parts added by the lab admin will appear here.</p></div>`;
        return;
    }
    const parts = visibleParts();
    if (!parts.length) {
        grid.innerHTML = `<div class="empty-state empty-state-error"><strong>No matching parts</strong><p>Try a different search or category.</p></div>`;
        return;
    }
    grid.innerHTML = parts.map(part => `
        <article class="part-card" data-part-id="${escapeHtml(part.id)}">
            <div class="part-card-head"><strong>${escapeHtml(part.name)}</strong><span class="part-category">${escapeHtml(part.category)}</span></div>
            <p class="part-meta">${escapeHtml(part.location)}</p>
            <div class="part-actions">
                <span class="part-qty ${part.quantity > 0 ? "" : "zero"}">${part.quantity > 0 ? `${part.quantity} in stock` : "Out of stock"}</span>
                <button class="add-button ${partCart[part.id] ? "added" : ""}" data-cart-action="toggle" type="button">${partCart[part.id] ? "In cart ✓" : "Add to cart"}</button>
            </div>
        </article>
    `).join("");
}

function cartItemCount() {
    return Object.values(partCart).reduce((total, entry) => total + entry.quantity, 0);
}

function renderCart() {
    const list = document.getElementById("cartList");
    const entries = Object.values(partCart);
    const totalItems = cartItemCount();
    document.getElementById("cartTotal").textContent = entries.length ? `${totalItems} item${totalItems === 1 ? "" : "s"}` : "0 items";
    document.getElementById("cartSummary").textContent = entries.length ? `${entries.length} part${entries.length === 1 ? "" : "s"} ready for review` : "No parts added yet.";
    document.getElementById("proposeButton").disabled = totalItems === 0;
    list.innerHTML = entries.length ? entries.map(entry => `
        <div class="cart-item" data-part-id="${escapeHtml(entry.part.id)}">
            <div class="cart-item-info"><strong>${escapeHtml(entry.part.name)}</strong><small>${escapeHtml(entry.part.category)}</small></div>
            <div class="cart-item-controls">
                <button class="cart-step" data-cart-action="decrement" type="button">−</button>
                <span class="cart-count">${entry.quantity}</span>
                <button class="cart-step" data-cart-action="increment" type="button">+</button>
                <button class="cart-remove" data-cart-action="remove" type="button">×</button>
            </div>
        </div>
    `).join("") : `<div class="empty-state compact-empty"><strong>Cart is empty</strong><p>Add parts from the registry to start a proposal.</p></div>`;
}

function setActiveTab(tabName) {
    document.querySelectorAll("[data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === tabName));
    document.querySelectorAll(".tab-view").forEach(view => view.classList.toggle("active", view.id === `${tabName}View`));
    const resetScroll = () => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    };
    resetScroll();
    requestAnimationFrame(resetScroll);
    const titles = {
        overview: ["Good morning,", currentUser?.name || "student", "Your lab community is moving."],
        partProposal: ["Part proposal", "requests", "Keep your component requests organized and easy to review."],
        borrowLogs: ["Borrow logs", "activity", "A clear trail of every item that leaves the lab."],
        projectProposal: ["Project proposals", "workspace", "Shape your next build, team up with friends, and keep it ready for the lab."]
    };
    const [lead, accent, description] = titles[tabName];
    document.getElementById("pageLead").textContent = lead;
    document.getElementById("pageAccent").textContent = accent;
    document.getElementById("pageDescription").textContent = description;

    if (tabName === "partProposal") {
        loadInventoryParts();
        loadMyProposals();
    }
    if (tabName === "projectProposal") {
        loadStudentProjects();
    }
    if (tabName === "borrowLogs") {
        loadBorrowLogs();
    }
}

function openProposeModal() {
    const entries = Object.values(partCart);
    if (!entries.length) return;
    document.getElementById("proposeItems").innerHTML = entries.map(entry => `
        <div class="modal-item"><strong>${escapeHtml(entry.part.name)}</strong><span>× ${entry.quantity}</span></div>
    `).join("");
    document.getElementById("proposeReason").value = "";
    document.getElementById("proposeModal").classList.add("open");
    document.getElementById("proposeModal").setAttribute("aria-hidden", "false");
    document.getElementById("proposeReason").focus();
}

function closeProposeModal() {
    document.getElementById("proposeModal").classList.remove("open");
    document.getElementById("proposeModal").setAttribute("aria-hidden", "true");
}

function statusLabel(status) {
    return { pending: "Awaiting review", standby: "On standby", approved: "Approved", declined: "Declined" }[status] || status;
}

function proposalAge(value) {
    return formatTime(value);
}

async function loadMyProposals() {
    const { data: proposalRows, error } = await supabaseClient
        .from("part_proposals")
        .select("id, student_id, reason, duration_days, items, status, reviewed_note, created_at")
        .order("created_at", { ascending: false });
    const list = document.getElementById("requestList");
    if (error) {
        console.error("Proposal load error:", error);
        list.innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load your proposals</strong><p>Run the admin SQL migration first.</p></div>`;
        return;
    }
    const proposals = (proposalRows || []).filter(proposal => proposal.student_id === currentUser.id);
    if (!proposals.length) {
        list.innerHTML = `<div class="empty-state"><strong>No proposals yet</strong><p>Send your first part request and it will be tracked here.</p></div>`;
        return;
    }
    list.innerHTML = proposals.slice(0, 3).map(proposal => {
        const items = Array.isArray(proposal.items) ? proposal.items : [];
        return `
        <div class="request-row" data-proposal-id="${escapeHtml(proposal.id)}">
            <div>
                <strong>${escapeHtml(proposal.reason)}</strong>
                <small>${proposalAge(proposal.created_at)} · ${escapeHtml(proposal.duration_days)} day${proposal.duration_days === 1 ? "" : "s"}${proposal.reviewed_note ? ` · ${escapeHtml(proposal.reviewed_note)}` : ""}</small>
                <div class="request-items">${items.map(item => `${escapeHtml(item.name)} × ${item.quantity}`).join(" · ") || "No items"}</div>
            </div>
            <span class="request-status ${escapeHtml(proposal.status)}">${statusLabel(proposal.status)}</span>
        </div>`;
    }).join("");
}

/* ---------------- Borrow logs ---------------- */

const borrowStatusLabel = proposal => proposal.returned_at ? "Returned" : proposal.lent_at ? "With you" : proposal.status === "approved" ? "Ready to collect" : statusLabel(proposal.status);

function borrowTimeLeft(proposal) {
    if (!proposal.due_at || proposal.returned_at) return "";
    const seconds = Math.floor((new Date(proposal.due_at).getTime() - clockNow().getTime()) / 1000);
    if (seconds <= 0) return "Overdue";
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min left`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr left`;
    return `${Math.floor(seconds / 86400)} days left`;
}

async function loadBorrowLogs() {
    const { data, error } = await supabaseClient
        .from("part_proposals")
        .select("id, student_id, reason, duration_days, items, status, reviewed_note, reviewed_at, created_at, lent_at, due_at, returned_at, photo_url, return_note")
        .order("created_at", { ascending: false });
    const list = document.getElementById("borrowList");
    if (error) {
        list.innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load your borrow logs</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Borrow log error:", error);
        return;
    }
    borrowLogs = (data || []).filter(proposal => proposal.student_id === currentUser.id);
    renderBorrowLogs();
}

function borrowFilterStatus(proposal) {
    if (proposal.returned_at) return "returned";
    if (proposal.lent_at) return "active";
    if (proposal.status === "approved") return "approved";
    if (proposal.status === "declined") return "declined";
    return "pending";
}

function renderBorrowLogs() {
    const list = document.getElementById("borrowList");
    const search = document.getElementById("borrowSearch").value.trim().toLowerCase();
    const status = document.getElementById("borrowStatusFilter").value;
    const from = document.getElementById("borrowDateFrom").value;
    const to = document.getElementById("borrowDateTo").value;
    const filtered = borrowLogs.filter(proposal => {
        const items = Array.isArray(proposal.items) ? proposal.items : [];
        const searchable = [proposal.reason, proposal.status, ...items.map(item => item.name)].join(" ").toLowerCase();
        const createdDate = proposal.created_at.slice(0, 10);
        return (!search || searchable.includes(search))
            && (status === "all" || borrowFilterStatus(proposal) === status)
            && (!from || createdDate >= from)
            && (!to || createdDate <= to);
    });
    const count = document.getElementById("borrowHistoryCount");
    count.textContent = `${filtered.length} of ${borrowLogs.length} record${borrowLogs.length === 1 ? "" : "s"}`;
    if (!borrowLogs.length) {
        list.innerHTML = `<div class="empty-state"><strong>No borrow activity yet</strong><p>Proposals you send will be tracked here with their pick-up receipt.</p></div>`;
        return;
    }
    if (!filtered.length) {
        list.innerHTML = `<div class="empty-state"><strong>No matching history</strong><p>Try a different search, date range, or status.</p></div>`;
        return;
    }
    list.innerHTML = filtered.map(proposal => {
        const items = Array.isArray(proposal.items) ? proposal.items : [];
        const timeLeft = borrowTimeLeft(proposal);
        return `
        <div class="borrow-row" data-borrow-row data-borrow-id="${escapeHtml(proposal.id)}">
            <div class="borrow-row-main">
                <strong>${escapeHtml(proposal.reason)}</strong>
                <small>${formatTime(proposal.created_at)} · ${escapeHtml(proposal.duration_days)} day${proposal.duration_days === 1 ? "" : "s"} · ${items.length} part${items.length === 1 ? "" : "s"}</small>
                <div class="request-items">${items.map(item => `${escapeHtml(item.name)} × ${item.quantity}`).join(" · ") || "No items"}</div>
            </div>
            <div class="borrow-row-side">
                <span class="request-status ${escapeHtml(proposal.status)}${proposal.lent_at && !proposal.returned_at ? " lent" : ""}">${borrowStatusLabel(proposal)}</span>
                ${timeLeft ? `<span class="borrow-timeleft">${escapeHtml(timeLeft)}</span>` : ""}
            </div>
        </div>`;
    }).join("");
}

function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function receiptEvent(label, value, done) {
    return `<div class="timeline-item${done ? " done" : ""}"><span class="timeline-dot"></span><div><strong>${escapeHtml(label)}</strong><small>${value ? escapeHtml(new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })) : "—"}</small></div></div>`;
}

function openReceipt(proposalId) {
    const proposal = borrowLogs.find(item => item.id === proposalId);
    if (!proposal) return;
    activeReceiptId = proposalId;
    const items = Array.isArray(proposal.items) ? proposal.items : [];
    const verified = proposal.status === "approved";
    const isOut = proposal.lent_at && !proposal.returned_at;
    const code = `OTT-${proposal.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    document.getElementById("receiptTitle").textContent = proposal.reason;
    let notice = `<div class="receipt-notice">Awaiting review — this receipt becomes valid once approved.</div>`;
    if (isOut) notice = `<div class="receipt-notice live">The parts are with you. Return them before the due date.</div>`;
    else if (proposal.returned_at) notice = `<div class="receipt-notice done">Returned safely to the lab. Nothing left to do.</div>`;
    else if (proposal.status === "approved") notice = `<div class="receipt-notice ready">Verified — show this receipt at the lab to collect the parts.</div>`;
    else if (proposal.status === "declined") notice = `<div class="receipt-notice declined">This request was declined, so this receipt is not valid.</div>`;
    document.getElementById("receiptBody").innerHTML = `
        <div class="receipt-top">
            <div>
                <span class="receipt-code">${escapeHtml(code)}</span>
                <p class="receipt-holder">${escapeHtml(currentUser.name)}<small>Issued ${escapeHtml(new Date(proposal.created_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }))}</small></p>
            </div>
            <div class="receipt-seal${verified ? " verified" : ""}">${verified ? "✓ Verified" : "Unverified"}</div>
        </div>
        ${notice}
        ${isOut ? `<div class="receipt-timer"><span>Time left with the parts</span><strong id="receiptCountdown">${escapeHtml(formatCountdown(new Date(proposal.due_at).getTime() - clockNow().getTime()))}</strong><small>Due ${escapeHtml(new Date(proposal.due_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</small></div>` : ""}
        <div class="receipt-parts"><div class="receipt-label">Parts on this receipt</div><div class="modal-items">${items.map(item => `<div class="modal-item"><strong>${escapeHtml(item.name)}</strong><span>× ${item.quantity}</span></div>`).join("") || `<div class="modal-item"><strong>No parts listed</strong></div>`}</div></div>
        <div class="receipt-timeline"><div class="receipt-label">Full timeline</div>
            ${receiptEvent("Proposal sent", proposal.created_at, true)}
            ${receiptEvent(proposal.status === "pending" ? "Review" : `Reviewed — ${statusLabel(proposal.status)}`, proposal.reviewed_at, Boolean(proposal.reviewed_at))}
            ${receiptEvent("Collected from the lab", proposal.lent_at, Boolean(proposal.lent_at))}
            ${receiptEvent("Due back", proposal.due_at, Boolean(proposal.due_at))}
            ${proposal.returned_at ? receiptEvent("Returned", proposal.returned_at, true) : ""}
        </div>
        ${proposal.photo_url ? `<div class="receipt-photo"><div class="receipt-label">Photo taken before hand-over</div><img src="${escapeHtml(proposal.photo_url)}" alt="Parts at hand-over"></div>` : ""}
    `;
    document.getElementById("receiptModal").classList.add("open");
    document.getElementById("receiptModal").setAttribute("aria-hidden", "false");
    startReceiptTimer(proposal);
}

function startReceiptTimer(proposal) {
    clearInterval(receiptTimer);
    if (!proposal.lent_at || !proposal.due_at || proposal.returned_at) return;
    receiptTimer = setInterval(() => {
        const countdown = document.getElementById("receiptCountdown");
        if (!countdown) return;
        const remaining = new Date(proposal.due_at).getTime() - clockNow().getTime();
        countdown.textContent = remaining <= 0 ? "Overdue" : formatCountdown(remaining);
    }, 1000);
}

function closeReceipt() {
    clearInterval(receiptTimer);
    receiptTimer = null;
    activeReceiptId = null;
    document.getElementById("receiptModal").classList.remove("open");
    document.getElementById("receiptModal").setAttribute("aria-hidden", "true");
}

async function submitProposal(event) {
    event.preventDefault();
    const reason = document.getElementById("proposeReason").value.trim();
    const durationDays = Number(document.getElementById("proposeDuration").value);
    if (!reason) { showToast("Explain why you need these parts"); return; }
    if (![3, 7, 10, 14].includes(durationDays)) { showToast("Choose one of the fixed borrow durations"); return; }
    const entries = Object.values(partCart);
    if (!entries.length) { closeProposeModal(); return; }

    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Sending...";

    const items = entries.map(entry => ({
        id: entry.part.id,
        name: entry.part.name,
        category: entry.part.category,
        quantity: entry.quantity
    }));
    const { error } = await supabaseClient.rpc("student_create_proposal", {
        p_reason: reason,
        p_duration_days: durationDays,
        p_items: items
    });

    button.disabled = false;
    button.textContent = "Send proposal →";

    if (error) {
        showToast(error.message || "Could not send that proposal");
        console.error("Proposal create error:", error);
        return;
    }

    partCart = {};
    renderPartsGrid();
    renderCart();
    closeProposeModal();
    showToast("Proposal sent to your teacher");
    await loadMyProposals();
}

function studentProjectDetail(label, value) {
    return value ? `<div class="project-detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` : "";
}

async function loadStudentProjects() {
    if (!currentUser) return;
    const [projectsResult, sharesResult, interestsResult] = await Promise.all([
        supabaseClient.from("project_proposals").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("project_shares").select("*").order("created_at", { ascending: false }),
        supabaseClient.from("project_interests").select("project_id, confirmed").eq("student_id", currentUser.id)
    ]);
    const list = document.getElementById("studentProjects");
    if (projectsResult.error) {
        list.innerHTML = `<div class="empty-state empty-state-error"><strong>Could not load projects</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Project load error:", projectsResult.error);
        return;
    }
    const shares = sharesResult.data || [];
    allShares = shares.filter(share => share.sharer_id === currentUser.id);
    sharedToMe = shares.filter(share => share.invitee_id === currentUser.id);
    const myInterests = interestsResult.error ? [] : (interestsResult.data || []);
    projectById = {};
    (projectsResult.data || []).forEach(project => { projectById[project.id] = project; });
    const invitedLookup = new Set();
    const visible = (projectsResult.data || []).filter(project => {
        const invited = (Array.isArray(project.invited_students) ? project.invited_students : []).some(student => student.id === currentUser.id);
        if (invited) invitedLookup.add(project.id);
        const shared = sharedToMe.some(share => share.project_id === project.id && share.status === "yes");
        return invited || shared;
    });
    if (!visible.length) {
        list.innerHTML = `<div class="empty-state"><strong>No invites yet</strong><p>Projects your teachers send you — or friends share with you — will appear here.</p></div>`;
        return;
    }
    list.innerHTML = visible.map(project => {
        const interest = myInterests.find(item => item.project_id === project.id);
        const interestOn = !!interest;
        const confirmed = !!interest?.confirmed;
        const sharer = sharedToMe.find(share => share.project_id === project.id && share.status === "yes");
        const mine = allShares.filter(share => share.project_id === project.id);
        return `
        <article class="project-card" data-project-id="${escapeHtml(project.id)}">
            <div class="project-card-top">
                ${invitedLookup.has(project.id) || !sharer
                    ? `<span class="project-cat invited">Invited by a teacher</span>`
                    : `<span class="project-cat shared">Shared to you by ${escapeHtml(sharer.sharer_name || "a friend")}</span>`}
                <div><strong>${escapeHtml(project.title)}</strong><small>${escapeHtml(project.teacher_name)} · ${formatTime(project.created_at)}</small></div>
            </div>
            ${project.brief ? `<p class="project-brief">${escapeHtml(project.brief)}</p>` : ""}
            <div class="project-details">
                ${studentProjectDetail("When", project.held_date)}
                ${studentProjectDetail("Where", project.location)}
                ${studentProjectDetail("Transport", project.school_transport)}
                ${studentProjectDetail("School pays", project.school_funding)}
                ${project.website ? `<div class="project-detail"><span>Website</span><a href="${escapeHtml(project.website)}" target="_blank" rel="noopener">${escapeHtml(project.website)} ↗</a></div>` : ""}
            </div>
            ${mine.length ? `<div class="share-out-row"><span>You shared this with</span>${mine.map(share => `<span class="part-chip">${escapeHtml(share.invitee_name || "Friend")}</span>`).join("")}</div>` : ""}
            ${!interestOn
                ? `<button class="interested-button" data-project-action="interested" data-project-id="${escapeHtml(project.id)}" type="button">I'm interested</button>`
                : confirmed
                    ? `<div class="attend-row"><span class="attend-chip">★ Attending · confirmed</span><button class="interested-button marked" data-project-action="share" data-project-id="${escapeHtml(project.id)}" type="button">Reach out to friends</button></div>`
                    : `<div class="attend-row"><button class="interested-button" data-project-action="confirm" data-project-id="${escapeHtml(project.id)}" type="button">Confirm attendance</button><small class="confirm-hint">Confirm to unlock reaching out to friends</small></div>`}
        </article>`;
    }).join("");
}

async function loadDeadlines() {
    const list = document.getElementById("deadlineList");
    if (!currentUser) return;
    const [interestsResult, loansResult] = await Promise.all([
        supabaseClient.from("project_interests").select("project_id").eq("student_id", currentUser.id),
        supabaseClient.from("part_proposals").select("id, reason, due_at, items").eq("student_id", currentUser.id).not("lent_at", "is", null).is("returned_at", null)
    ]);
    if (interestsResult.error) {
        list.innerHTML = `<div class="empty-state compact-empty empty-state-error"><strong>Deadlines unavailable</strong><p>Run the admin SQL migration first.</p></div>`;
        console.error("Deadline interest error:", interestsResult.error);
        return;
    }
    const ids = [...new Set((interestsResult.data || []).map(interest => interest.project_id))];
    let projects = [];
    if (ids.length) {
        const { data, error } = await supabaseClient.from("project_proposals").select("id, title, teacher_name, deadline, make_deadline").in("id", ids);
        if (error) { console.error("Deadline load error:", error); }
        else projects = data || [];
    }
    const rows = [];
    (loansResult.data || []).forEach(loan => {
        if (!loan.due_at) return;
        const date = new Date(loan.due_at).toISOString().slice(0, 10);
        const count = partItemCount(loan);
        rows.push({ title: loan.reason || "Borrowed equipment", meta: `${count} part${count === 1 ? "" : "s"} · on loan`, date, badges: deadlineBadge(date, "Return by") });
    });
    projects.forEach(project => {
        if (!project.deadline && !project.make_deadline) return;
        rows.push({
            title: project.title,
            meta: project.teacher_name,
            date: [project.deadline, project.make_deadline].filter(Boolean).sort()[0],
            badges: `${deadlineBadge(project.deadline, "Sign up")}${deadlineBadge(project.make_deadline, "Make by")}`
        });
    });
    rows.sort((a, b) => a.date.localeCompare(b.date));
    if (!rows.length) {
        list.innerHTML = `<div class="empty-state compact-empty"><strong>No deadlines yet</strong><p>Return dates for your loans and deadlines for projects you join will appear here.</p></div>`;
        return;
    }
    list.innerHTML = rows.map(row => `
        <div class="deadline-row">
            <div class="deadline-main">
                <strong>${escapeHtml(row.title)}</strong>
                <small>${escapeHtml(row.meta)}</small>
            </div>
            <div class="deadline-badges">${row.badges}</div>
        </div>`).join("");
}

function deadlineBadge(value, label) {
    if (!value) return "";
    const due = new Date(`${value}T00:00:00`);
    const days = Math.round((due - new Date(clockNow().toDateString())) / 86400000);
    const state = days < 0 ? "past" : days <= 3 ? "soon" : "open";
    const left = days < 0 ? "passed" : days === 0 ? "today" : days === 1 ? "1 day left" : `${days} days left`;
    return `<span class="deadline-badge ${state}">${label} · ${escapeHtml(due.toLocaleDateString(undefined, { day: "numeric", month: "short" }))} · ${left}</span>`;
}

async function toggleProjectInterest(projectId) {
    const { data: existing, error: lookupError } = await supabaseClient.from("project_interests").select("id").eq("project_id", projectId).eq("student_id", currentUser.id).maybeSingle();
    if (lookupError) { showToast("Could not update your interest"); return; }
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Student";
    const result = existing
        ? await supabaseClient.from("project_interests").delete().eq("id", existing.id)
        : await supabaseClient.from("project_interests").insert({ project_id: projectId, student_id: currentUser.id, student_name: name });
    if (result.error) {
        showToast("Could not update your interest");
        console.error("Interest update error:", result.error);
        return;
    }
    await loadStudentProjects();
    await loadDeadlines();
}

async function toggleLike(postId, button) {
    const { data: existing, error: lookupError } = await supabaseClient.from("announcement_likes").select("announcement_id").eq("announcement_id", postId).eq("user_id", currentUser.id).maybeSingle();
    if (lookupError) { showToast("Could not update that like"); return; }
    const result = existing
        ? await supabaseClient.from("announcement_likes").delete().eq("announcement_id", postId).eq("user_id", currentUser.id)
        : await supabaseClient.from("announcement_likes").insert({ announcement_id: postId, user_id: currentUser.id });
    if (result.error) { showToast("Could not update that like"); return; }
    button.classList.toggle("liked", !existing);
    await loadAnnouncements();
}

/* ---------------- Noise — sharing teacher projects with friends ---------------- */

async function confirmProjectInterest(projectId) {
    const { data: ok, error } = await supabaseClient.rpc("confirm_project_interest", { p_project_id: projectId });
    if (error || !ok) { showToast("Mark the project as interested first"); console.error("Confirm interest error:", error); return; }
    showToast("Attendance confirmed — you can now reach out to friends");
    await Promise.all([loadStudentProjects(), loadDeadlines()]);
}

function shareBudget() {
    return Math.min(Math.max(0, 5 - shareActiveCount), Math.max(0, 10 - shareDailyCount));
}

async function openShareModal(projectId) {
    shareTargetId = projectId;
    sharePick = {};
    const project = projectById[projectId];
    document.getElementById("inviteTitle").textContent = project ? `Reach out — ${project.title}` : "Reach out to friends";
    if (!allClassmates.length) {
        const { data, error } = await supabaseClient.rpc("list_classmates", { p_search: "" });
        if (error) { console.error("Classmate load error:", error); allClassmates = []; }
        else allClassmates = data || [];
    }
    shareClosed = [];
    (Array.isArray(project?.invited_students) ? project.invited_students : []).forEach(student => shareClosed.push(student.id));
    allShares.filter(share => share.project_id === projectId).forEach(share => shareClosed.push(share.invitee_id));
    shareActiveCount = allShares.filter(share => share.project_id === projectId && share.status === "yes").length;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dailyResult = await supabaseClient.from("project_shares").select("id", { count: "exact", head: true }).eq("sharer_id", currentUser.id).gte("created_at", dayStart.toISOString());
    shareDailyCount = dailyResult.count || 0;
    document.getElementById("inviteSearch").value = "";
    renderSharePicker();
    document.getElementById("inviteModal").classList.add("open");
}

function renderSharePicker() {
    const query = document.getElementById("inviteSearch").value.trim().toLowerCase();
    const closed = new Set(shareClosed);
    const filtered = allClassmates.filter(classmate => !query || (classmate.name || "").toLowerCase().includes(query));
    const selectedCount = Object.values(sharePick).filter(Boolean).length;
    const budget = shareBudget();
    document.getElementById("sendInviteButton").disabled = selectedCount === 0 || budget <= 0;
    document.getElementById("inviteDailyLabel").textContent = `Shares today: ${shareDailyCount}/10`;
    document.getElementById("invitePendingLabel").textContent = `Already on this project: ${closed.size}`;
    document.getElementById("inviteHint").textContent = budget <= 0
        ? "You've used your share slots (max 5 friends per project) — ask your teacher to adjust."
        : `${selectedCount} selected · ${budget} slot${budget === 1 ? "" : "s"} left · max 5 friends per project`;
    const list = document.getElementById("inviteList");
    if (!filtered.length) {
        list.innerHTML = `<div class="empty-state compact-empty"><strong>No classmates found</strong><p>Try another name.</p></div>`;
        return;
    }
    list.innerHTML = filtered.map(classmate => {
        const isClosed = closed.has(classmate.id);
        const checked = !!sharePick[classmate.id];
        return `<div class="invite-row ${checked ? "selected" : ""}${isClosed ? " disabled" : ""}" data-invite-option="${escapeHtml(classmate.id)}">
            <span class="invite-avatar">${escapeHtml(initialsFor(classmate.name))}</span>
            <span class="invite-name">${escapeHtml(classmate.name)}</span>
            ${isClosed
                ? `<span class="invite-state invited">Already on it</span>`
                : `<span class="invite-state">${checked ? "Selected" : "Tap to select"}</span>`}
        </div>`;
    }).join("");
}

async function submitShare(event) {
    event.preventDefault();
    const selected = Object.entries(sharePick).filter(([, on]) => on).map(([id]) => id);
    if (!selected.length || !shareTargetId) return;
    const button = document.getElementById("sendInviteButton");
    button.disabled = true;
    const { data, error } = await supabaseClient.rpc("share_project", { p_project_id: shareTargetId, p_invitee_ids: selected });
    button.disabled = false;
    if (error) { showToast("Reach out only works after you confirm attendance"); console.error("Share send error:", error); return; }
    let message = "";
    if (data?.limit) {
        message = data.limit === "per_project" ? "Too many friends shared on this project from you (max 5)" : "Daily share limit reached (max 10)";
    } else {
        const sent = data?.sent?.length || 0;
        const skipped = data?.skipped?.length || 0;
        const incomingLimited = data?.incoming_limited?.length || 0;
        if (sent) message += `Project shared with ${sent} friend${sent === 1 ? "" : "s"}`;
        if (skipped) message += (message ? " · " : "") + `${skipped} already on this project`;
        if (incomingLimited) message += (message ? " · " : "") + `${incomingLimited} already reached their 5-friend limit`;
    }
    document.getElementById("inviteModal").classList.remove("open");
    if (message) showToast(message);
    await loadStudentProjects();
}

document.addEventListener("click", async event => {
    const projectAction = event.target.closest("[data-project-action]");
    if (!projectAction) return;
    if (projectAction.dataset.projectAction === "confirm") await confirmProjectInterest(projectAction.dataset.projectId);
    if (projectAction.dataset.projectAction === "share") await openShareModal(projectAction.dataset.projectId);
});

document.addEventListener("click", async event => {
    const tab = event.target.closest("[data-tab]");
    if (tab) setActiveTab(tab.dataset.tab);

    const projectAction = event.target.closest("[data-project-action]");
    if (projectAction && projectAction.dataset.projectAction === "interested") {
        await toggleProjectInterest(projectAction.dataset.projectId);
        return;
    }

    const cartAction = event.target.closest("[data-cart-action]");
    if (cartAction) {
        const partId = cartAction.closest("[data-part-id]")?.dataset.partId;
        if (!partId) return;
        if (cartAction.dataset.cartAction === "toggle") {
            const part = inventoryParts.find(item => item.id === partId);
            if (!part) return;
            if (partCart[partId]) {
                delete partCart[partId];
            } else {
                if (part.quantity <= 0) { showToast("This part is out of stock"); return; }
                partCart[partId] = { part, quantity: 1 };
            }
        } else {
            const entry = partCart[partId];
            if (!entry) return;
            if (cartAction.dataset.cartAction === "increment") {
                if (entry.quantity >= entry.part.quantity) { showToast("No more stock available"); return; }
                entry.quantity += 1;
            } else if (cartAction.dataset.cartAction === "decrement") {
                entry.quantity -= 1;
                if (entry.quantity <= 0) delete partCart[partId];
            } else {
                delete partCart[partId];
            }
        }
        renderPartsGrid();
        renderCart();
        return;
    }

    const commentAction = event.target.closest("[data-comment-action]");
    if (commentAction) {
        const commentEl = commentAction.closest("[data-comment-id]");
        if (!commentEl) return;
        if (commentAction.dataset.commentAction === "delete") {
            if (!confirm("Delete this comment?")) return;
            const { error } = await supabaseClient.rpc("delete_comment", { p_comment_id: commentEl.dataset.commentId });
            if (error) { showToast(/own comments/i.test(error.message || "") ? "You can only delete your own comments" : "Could not delete that comment"); console.error("Comment delete error:", error); return; }
            showToast("Comment deleted");
            return loadAnnouncements();
        }
        if (commentAction.dataset.commentAction === "edit") return startCommentEdit(commentEl);
        if (commentAction.dataset.commentAction === "cancelCommentEdit") return loadAnnouncements();
        return;
    }

    const action = event.target.closest("[data-action]");
    if (!action) return;
    const card = action.closest("[data-post-id]");
    if (!card) return;
    if (action.dataset.action === "like") await toggleLike(card.dataset.postId, action);
    if (action.dataset.action === "comment") {
        const comments = card.querySelector("[data-comments]");
        comments.classList.toggle("open");
        if (comments.classList.contains("open")) openCommentPostIds.add(card.dataset.postId);
        else openCommentPostIds.delete(card.dataset.postId);
    }
    if (action.dataset.action === "share") {
        await navigator.clipboard?.writeText(`${location.href.split("#")[0]}#announcement-${card.dataset.postId}`);
        showToast("Announcement link copied");
    }
});

document.getElementById("partSearch").addEventListener("input", renderPartsGrid);
document.getElementById("partCategoryFilter").addEventListener("change", renderPartsGrid);
document.getElementById("proposeButton").addEventListener("click", openProposeModal);
document.getElementById("proposeClose").addEventListener("click", closeProposeModal);
document.getElementById("proposeModal").addEventListener("click", event => { if (event.target === event.currentTarget) closeProposeModal(); });
document.getElementById("proposeForm").addEventListener("submit", submitProposal);
document.getElementById("borrowList").addEventListener("click", async event => {
    const row = event.target.closest("[data-borrow-row]");
    if (row) openReceipt(row.dataset.borrowId);
});
["borrowSearch", "borrowStatusFilter", "borrowDateFrom", "borrowDateTo"].forEach(id => {
    document.getElementById(id).addEventListener("input", renderBorrowLogs);
    document.getElementById(id).addEventListener("change", renderBorrowLogs);
});
document.getElementById("receiptClose").addEventListener("click", closeReceipt);
document.getElementById("receiptModal").addEventListener("click", event => { if (event.target === event.currentTarget) closeReceipt(); });

document.getElementById("inviteClose").addEventListener("click", () => document.getElementById("inviteModal").classList.remove("open"));
document.getElementById("inviteModal").addEventListener("click", event => { if (event.target === event.currentTarget) event.currentTarget.classList.remove("open"); });
document.getElementById("inviteSearch").addEventListener("input", renderSharePicker);
document.getElementById("inviteList").addEventListener("click", event => {
    const row = event.target.closest("[data-invite-option]");
    if (!row) return;
    const userId = row.dataset.inviteOption;
    if (shareClosed.includes(userId)) return;
    if (!sharePick[userId] && Object.values(sharePick).filter(Boolean).length >= shareBudget()) {
        showToast("Share budget for today is used up");
        return;
    }
    sharePick[userId] = !sharePick[userId];
    renderSharePicker();
});
document.getElementById("inviteForm").addEventListener("submit", submitShare);
document.getElementById("postList").addEventListener("submit", async event => {
    if (event.target.matches(".comment-edit-form")) {
        event.preventDefault();
        const textarea = event.target.querySelector("textarea");
        const body = (textarea?.value || "").trim();
        if (!body) return;
        const commentId = event.target.dataset.commentId;
        const { error } = await supabaseClient.rpc("edit_comment", { p_comment_id: commentId, p_body: body });
        if (error) { showToast(/own comments/i.test(error.message || "") ? "You can only edit your own comments" : "Could not edit that comment"); console.error("Comment edit error:", error); return; }
        showToast("Comment updated");
        return loadAnnouncements();
    }
    if (!event.target.matches(".comment-form")) return;
    event.preventDefault();
    const input = event.target.querySelector("input");
    const body = input.value.trim();
    if (!body) return;
    const postId = event.target.closest("[data-post-id]").dataset.postId;
    if (await onCooldownFromLastComment(input)) return;
    const name = currentUser.user_metadata?.full_name || currentUser.email?.split("@")[0] || "Student";
    const { error } = await supabaseClient.from("announcement_comments").insert({ announcement_id: postId, author_id: currentUser.id, author_name: name, body });
    if (error) { showToast(/slow down/i.test(error.message || "") ? "Please slow down — wait a bit before commenting again" : "Could not add that comment"); return; }
    openCommentPostIds.add(postId);
    await loadAnnouncements();
});

async function onCooldownFromLastComment(input) {
    const since = new Date(Date.now() - 60000).toISOString();
    const { count, error } = await supabaseClient.from("announcement_comments")
        .select("id", { count: "exact", head: true })
        .eq("author_id", currentUser.id)
        .gte("created_at", since);
    if (error) return false;
    if ((count || 0) >= 17) {
        showToast("Please slow down — wait a bit before commenting again");
        input?.focus();
        return true;
    }
    return false;
}

function startCommentEdit(commentEl) {
    const textEl = commentEl.querySelector(".comment-text");
    const actionEl = commentEl.querySelector(".comment-actions");
    const form = document.createElement("form");
    form.className = "comment-edit-form";
    form.dataset.commentId = commentEl.dataset.commentId;
    form.innerHTML = `<textarea maxlength="300" aria-label="Edit your comment">${escapeHtml(textEl.textContent)}</textarea><div class="comment-edit-actions"><button type="submit">Save</button><button type="button" data-comment-action="cancelCommentEdit">Cancel</button></div>`;
    if (textEl) textEl.replaceWith(form);
    if (actionEl) actionEl.remove();
    form.querySelector("textarea").focus();
}

document.querySelector(".sign-out").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "index.html";
});

async function initialiseDashboard() {
    await refreshSimClock();

    const { data: { user }, error } = await supabaseClient.auth.getUser();
    if (error || !user) {
        window.location.href = "index.html";
        return;
    }
    currentUser = user;
    const { data: activeBan } = await supabaseClient
        .from("user_bans")
        .select("banned_until, reason")
        .eq("user_id", user.id)
        .gt("banned_until", new Date().toISOString())
        .maybeSingle();
    if (activeBan) {
        await supabaseClient.auth.signOut();
        alert(`Your account is restricted until ${new Date(activeBan.banned_until).toLocaleString()}.\nReason: ${activeBan.reason}`);
        window.location.href = "index.html";
        return;
    }
    const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "student";
    currentUser.name = displayName;
    renderDashboardDate();
    document.querySelector(".profile-chip span").textContent = displayName;
    document.querySelector(".profile-avatar").textContent = initialsFor(displayName);
    setActiveTab("overview");
    await Promise.all([loadOverviewMetrics(), loadDeadlines(), loadStudentProjects(), loadAnnouncements()]);

    supabaseClient.channel("announcements-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "announcements" }, loadAnnouncements)
        .on("postgres_changes", { event: "*", schema: "public", table: "announcement_likes" }, loadAnnouncements)
        .on("postgres_changes", { event: "*", schema: "public", table: "announcement_comments" }, loadAnnouncements)
        .subscribe();

    supabaseClient.channel("overview-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "part_proposals" }, () => { loadOverviewMetrics(); loadDeadlines(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "project_interests" }, () => { loadOverviewMetrics(); loadDeadlines(); })
        .subscribe();

    supabaseClient.channel("inventory-parts-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "inventory_parts" }, loadInventoryParts)
        .subscribe();

    supabaseClient.channel("my-proposals-feed")
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "part_proposals" }, () => { loadMyProposals(); loadBorrowLogs(); })
        .subscribe();

    supabaseClient.channel("student-projects-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "project_proposals" }, () => { loadStudentProjects(); loadDeadlines(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "project_interests" }, () => { loadStudentProjects(); loadDeadlines(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "sim_clock" }, async () => { await refreshSimClock(); renderDashboardDate(); loadDeadlines(); })
        .subscribe();
    supabaseClient.channel("noise-feed")
        .on("postgres_changes", { event: "*", schema: "public", table: "project_shares" }, () => { loadStudentProjects(); loadDeadlines(); })
        .subscribe();
}

initialiseDashboard();