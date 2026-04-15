const express = require('express');
const session = require('express-session');
const { Issuer } = require('openid-client');

const app = express();

/**
 * Session setup
 */
app.use(session({
  secret: 'iam-secret',
  resave: false,
  saveUninitialized: true
}));

let client;

/**
 * 👤 USER INFO EXTRACTION
 */
function getUserInfo(tokenSet) {
  try {
    let parsed;

    if (tokenSet.claims) {
      parsed = tokenSet.claims();
    } else {
      const base64Payload = tokenSet.id_token.split('.')[1];
      parsed = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
    }

    return {
      name: parsed?.name,
      username: parsed?.preferred_username,
      email: parsed?.email
    };
  } catch (err) {
    return {};
  }
}

/**
 * 🔥 ROLE EXTRACTION (CLEANED + STANDARDIZED)
 */
function getRoles(tokenSet) {
  try {
    let parsed;

    if (tokenSet.claims) {
      parsed = tokenSet.claims();
    } else if (tokenSet.id_token) {
      const base64Payload = tokenSet.id_token.split('.')[1];
      parsed = JSON.parse(Buffer.from(base64Payload, 'base64').toString());
    }

    let roles =
      parsed?.realm_access?.roles ||
      parsed?.real_access?.Roles ||
      parsed?.resource_access?.['node-app']?.roles ||
      [];

    const ignoreRoles = [
      'offline_access',
      'uma_authorization',
      'default-roles-company-realm'
    ];

    return roles.filter(role => !ignoreRoles.includes(role));
  } catch (err) {
    console.error(err);
    return [];
  }
}

/**
 * Initialize Keycloak connection
 */
async function initKeycloak() {
  const issuer = await Issuer.discover(
    'http://localhost:8080/realms/Company-Realm'
  );

  client = new issuer.Client({
    client_id: 'node-app',
    client_secret: '8GeAIh3woRIxcIpzw5795bXDH0oiGG32',
    redirect_uris: ['http://localhost:3000/callback'],
    response_types: ['code']
  });
}

/**
 * Home route
 */
app.get('/', (req, res) => {
  res.send('<a href="/login">Login with Keycloak</a>');
});

/**
 * Login route
 */
app.get('/login', (req, res) => {
  const url = client.authorizationUrl({
    scope: 'openid email profile'
  });
  res.redirect(url);
});

/**
 * Callback route
 */
app.get('/callback', async (req, res) => {
  const params = client.callbackParams(req);

  const tokenSet = await client.callback(
    'http://localhost:3000/callback',
    params
  );

  req.session.tokenSet = tokenSet;

  res.send(`
    <h2>Login Successful</h2>
    <a href="/secure">Go to IAM Dashboard</a>
  `);
});

/**
 * 🔐 TOKEN VIEWER
 */
app.get('/token', (req, res) => {
  if (!req.session.tokenSet) {
    return res.send('No token found. Please login first.');
  }

  const raw = req.session.tokenSet.id_token;
  const payload = raw.split('.')[1];

  const decoded = JSON.parse(
    Buffer.from(payload, 'base64').toString()
  );

  res.json(decoded);
});

/**
 * 🎯 IAM DASHBOARD (PROFESSIONAL VERSION)
 */
app.get('/secure', (req, res) => {
  if (!req.session.tokenSet) {
    return res.redirect('/login');
  }

  const roles = getRoles(req.session.tokenSet);
  const user = getUserInfo(req.session.tokenSet);

  const roleBadges = roles.map(role => {
    const color = role === 'admin' ? '#e74c3c' : '#3498db';
    return `<span style="
      background:${color};
      color:white;
      padding:5px 10px;
      margin-right:5px;
      border-radius:12px;
      font-size:12px;
    ">${role}</span>`;
  }).join('');

  res.send(`
    <div style="font-family:Arial; padding:30px; background:#f4f6f9; min-height:100vh;">

      <div style="background:white; padding:25px; border-radius:10px;">

        <h1>🔐 IAM Dashboard</h1>

        <h3>👤 User Information</h3>
        <p><b>Name:</b> ${user.name || 'N/A'}</p>
        <p><b>Username:</b> ${user.username || 'N/A'}</p>
        <p><b>Email:</b> ${user.email || 'N/A'}</p>

        <hr>

        <h3>🔑 Roles</h3>
        <div>${roleBadges || 'No roles found'}</div>

        <hr>

        <a href="/admin">Go to Admin</a> |
        <a href="/token">View JWT</a> |
        <a href="/logout">Logout</a>

      </div>
    </div>
  `);
});

/**
 * 🔒 ADMIN ROUTE (RBAC)
 */
app.get('/admin', (req, res) => {
  if (!req.session.tokenSet) {
    return res.redirect('/login');
  }

  const roles = getRoles(req.session.tokenSet);

  if (!roles.includes('admin')) {
    return res.status(403).send('Access Denied: Admins Only');
  }

  res.send(`
    <h1>Admin Dashboard</h1>
    <p>Welcome Admin 🚀</p>
  `);
});

/**
 * 🚪 LOGOUT (FIXED + CLEAN REDIRECT FLOW)
 */
app.get('/logout', (req, res) => {
  const idToken = req.session.tokenSet?.id_token;

  const logoutUrl =
    `http://localhost:8080/realms/Company-Realm/protocol/openid-connect/logout` +
    `?id_token_hint=${idToken}` +
    `&post_logout_redirect_uri=http://localhost:3000/login`;

  req.session.destroy(() => {
    res.redirect(logoutUrl);
  });
});

/**
 * START SERVER
 */
initKeycloak()
  .then(() => {
    app.listen(3000, () => {
      console.log('Server running on http://localhost:3000');
    });
  })
  .catch(err => {
    console.error('Failed to initialize Keycloak connection:', err);
  });