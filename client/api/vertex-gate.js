module.exports = (req, res) => {
  const user = process.env.VERTEX_USER;
  const pass = process.env.VERTEX_PASS;
  const target = process.env.OPENCLAW_PUBLIC_URL;

  if (!user || !pass) {
    return res.status(500).send("Vertex auth is not configured. Set VERTEX_USER and VERTEX_PASS.");
  }

  const auth = req.headers.authorization || "";
  const expected = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

  if (auth !== expected) {
    res.setHeader("WWW-Authenticate", 'Basic realm="maixed.com/vertex"');
    return res.status(401).send("Authentication required.");
  }

  if (!target) {
    return res.status(500).send("OPENCLAW_PUBLIC_URL is not configured.");
  }

  return res.redirect(302, target);
};
