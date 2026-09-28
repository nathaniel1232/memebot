const scenarios = [
  { name: "Bear", launches: 100, graduationRate: 0.005, failedVolume: 100, graduateVolume: 25_000, failedFeeRate: 0.003, graduateFeeRate: 0.003 },
  { name: "Base (illustrative)", launches: 100, graduationRate: 0.0084, failedVolume: 250, graduateVolume: 100_000, failedFeeRate: 0.003, graduateFeeRate: 0.005 },
  { name: "Bull", launches: 100, graduationRate: 0.02, failedVolume: 500, graduateVolume: 500_000, failedFeeRate: 0.003, graduateFeeRate: 0.0075 },
];
const usd = (value) => `$${value.toFixed(2)}`;
for (const s of scenarios) {
  const graduates = s.launches * s.graduationRate;
  const failures = s.launches - graduates;
  const gross = failures * s.failedVolume * s.failedFeeRate + graduates * s.graduateVolume * s.graduateFeeRate;
  console.log(`${s.name}: ${usd(gross)} gross creator fees / ${s.launches} launches`);
}
console.log("Break-even volume at 0.30% creator fee: operating cost / 0.003");
console.log("The $57 clip implies ~$2,850 volume at a 2% Pons creator tax, or $19,000 at Pump.fun's 0.30% bonding-curve creator fee.");
