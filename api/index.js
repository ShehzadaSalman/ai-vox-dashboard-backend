import app from "../src/index.js";

export default function handler(req, res) {
  return app(req, res);
}
