import app from "./app.js";

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`Stellar x402 games on http://localhost:${PORT}`);
  console.log(`  Wheel:  http://localhost:${PORT}/wheel/`);
  console.log(`  Trivia: http://localhost:${PORT}/trivia/`);
});
