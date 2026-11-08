const { sendJson, validateAdminSession } = require("../../server/admin-session");

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="CampusFix administration dashboard.">
    <title>Admin Dashboard | CampusFix</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <header class="site-header">
        <div class="container nav-wrap">
            <a class="brand" href="/index.html" aria-label="CampusFix home"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m2 11 14-7 14 7-14 7L2 11Z"/><path d="M8 14v7c4 3 12 3 16 0v-7"/><path d="M29 12v8"/></svg></span><span>Campus<span class="brand-accent">Fix</span></span></a>
            <button class="menu-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false" aria-controls="site-nav">Menu</button>
            <nav id="site-nav" class="site-nav" aria-label="Main navigation"><a href="/index.html">Home</a><a href="/index.html#report-form">Report Issue</a><a href="/reports.html">View Reports</a><button class="button button-secondary" id="admin-logout" type="button">Log out</button></nav>
        </div>
    </header>
    <main class="admin-page">
        <section class="page-intro"><div class="container"><p class="eyebrow">Campus operations</p><h1>Admin dashboard</h1><p>Keep track of incoming issues and help move every report toward resolution.</p></div></section>
        <section class="section admin-section"><div class="container">
            <div class="stats-grid">
                <article class="stat-card"><span class="stat-label">Total issues</span><strong id="stat-total">0</strong><small>All submitted reports</small></article>
                <article class="stat-card stat-pending"><span class="stat-label">Pending</span><strong id="stat-pending">0</strong><small>Waiting for action</small></article>
                <article class="stat-card stat-progress"><span class="stat-label">In progress</span><strong id="stat-progress">0</strong><small>Currently being handled</small></article>
                <article class="stat-card stat-resolved"><span class="stat-label">Resolved</span><strong id="stat-resolved">0</strong><small>Closed this semester</small></article>
            </div>
            <div class="admin-table-wrap">
                <div class="results-heading"><div><p class="eyebrow">Action queue</p><h2>Reported issues</h2></div><button class="button button-secondary" id="refresh-admin" type="button">Refresh reports</button></div>
                <div class="filter-bar">
                    <label class="filter-field" for="admin-category-filter">Category
                        <select id="admin-category-filter"><option value="all">All categories</option><option>Electricity</option><option>Water</option><option>Facilities</option><option>Sanitation</option><option>Security</option><option>Other</option></select>
                    </label>
                    <label class="filter-field" for="admin-status-filter">Status
                        <select id="admin-status-filter"><option value="all">All statuses</option><option>Pending</option><option>In Progress</option><option>Resolved</option></select>
                    </label>
                </div>
                <p id="admin-message" class="admin-message" role="status" aria-live="polite"></p>
                <div class="table-scroll"><table class="admin-table"><thead><tr><th>Issue</th><th>Description</th><th>Category</th><th>Location</th><th>Reported by</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody id="admin-list"></tbody></table></div>
            </div>
        </div></section>
    </main>
    <footer class="site-footer"><div class="container footer-wrap"><a class="brand brand-footer" href="/index.html"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m2 11 14-7 14 7-14 7L2 11Z"/><path d="M8 14v7c4 3 12 3 16 0v-7"/><path d="M29 12v8"/></svg></span><span>Campus<span class="brand-accent">Fix</span></span></a><p>Report it. Track it. Fix it.</p><span class="footer-copy">&copy; 2025 CampusFix</span></div></footer>
    <script src="/admin-dashboard.js"></script>
</body>
</html>`;

module.exports = async function adminDashboardPage(request, response) {
	if (request.method !== "GET") {
		response.setHeader("Allow", "GET");
		return sendJson(response, 405, { detail: "Method not allowed" });
	}

	const session = await validateAdminSession(request);
	if (!session.authorized) {
		if (session.status === 503) {
			return sendJson(response, 503, { detail: "Administrator authentication is unavailable" });
		}
		response.statusCode = 302;
		response.setHeader("Location", "/control-panel");
		response.setHeader("Cache-Control", "no-store");
		return response.end();
	}

	response.statusCode = 200;
	response.setHeader("Content-Type", "text/html; charset=utf-8");
	response.setHeader("Cache-Control", "private, no-store, max-age=0");
	response.setHeader("Vary", "Cookie");
	response.end(DASHBOARD_HTML);
};
