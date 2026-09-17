import { handler } from "../server/index.mjs";

export default (req, res) => {
  const id = req.query?.id ?? new URL(req.url, "http://localhost").searchParams.get("id");
  if (!id) return handler(req, res);
  const forwarded = Object.create(req);
  forwarded.url = `/api/assets/${encodeURIComponent(id)}`;
  return handler(forwarded, res);
};
