#!/usr/bin/env python3
"""
plot.py — visualize results produced by test/metrices.js

Usage:
  python plot.py
  python plot.py --in bench/out/results.json --outdir bench/out

It generates:
  - latency_summary.png
  - success_rates.png
  - security_metrics.png
  - verification_latency.png
  - scalability_tps.png
  - summary.txt
"""

import argparse
import json
from pathlib import Path
import matplotlib.pyplot as plt

# ---------- helpers ----------
def ensure_outdir(p: Path):
    p.mkdir(parents=True, exist_ok=True)

def load_results(path: Path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

def write_summary_txt(outdir: Path, R):
    agg = R.get("aggregates", {})
    trx_rel = R.get("transactionReliabilityPct", 0.0)
    adm_dec = R.get("adminDecentralizationIdxPct", 0.0)
    baseline = R.get("baseline", {})
    meta = R.get("meta", {})

    lines = []
    lines.append("RESULTS — SUMMARY")
    lines.append("=" * 72)
    lines.append(f"Network ID          : {meta.get('networkId', '?')}")
    lines.append(f"Contract            : {meta.get('contract', '?')}")
    lines.append(f"VerifyFn            : {meta.get('verifyFn', '?')}")
    lines.append("")
    lines.append("Performance (Latency, ms) & Success")
    for op in ["create", "verify", "revoke"]:
        a = agg.get(op, {})
        succ = a.get("success", 0)
        cnt = a.get("count", 0)
        rate = a.get("successRatePct", 0.0)
        lat = a.get("chainLatencyMs", {}) or {}
        lines.append(
            f"  {op:<8}  {succ}/{cnt} ({rate:.2f}%)  "
            f"avg={lat.get('avg', 0):.1f}  p50={lat.get('p50', 0):.1f}  p90={lat.get('p90', 0):.1f}"
        )
    lines.append("")
    lines.append(f"Transaction Reliability : {trx_rel:.2f}%")
    lines.append(f"Admin Decentralization  : {adm_dec:.2f}%")
    lines.append("")
    lines.append(
        f"Baseline TPS            : {baseline.get('tpsApprox', 0.0):.2f}  "
        f"(ops={baseline.get('ops', 0)}, elapsedMs={baseline.get('elapsedMs', 0)})"
    )
    lines.append("")
    sc = R.get("scalability", [])
    if sc:
        lines.append("Scalability (per scenario)")
        for s in sc:
            lines.append(
                f"  trials={s.get('trials')}  conc={s.get('concurrency')}  "
                f"conf={s.get('confirmations', 0)}  TPS={s.get('tpsApprox', 0.0):.2f}  "
                f"minedOps={s.get('minedOps', 0)} "
                f"(C/V/R={s.get('minedCreates', 0)}/{s.get('minedVerifies', 0)}/{s.get('minedRevokes', 0)})"
            )
    else:
        lines.append("Scalability: (no scenarios)")

    (outdir / "summary.txt").write_text("\n".join(lines), encoding="utf-8")

# ---------- plotting ----------
def plot_latency(outdir: Path, R):
    agg = R.get("aggregates", {})
    ops = ["create", "verify", "revoke"]
    labels, avg_vals, p50_vals, p90_vals = [], [], [], []

    for op in ops:
        a = agg.get(op, {}) or {}
        lat = a.get("chainLatencyMs", {}) or {}
        labels.append(op)
        avg_vals.append(float(lat.get("avg", 0.0)))
        p50_vals.append(float(lat.get("p50", 0.0)))
        p90_vals.append(float(lat.get("p90", 0.0)))

    x = range(len(labels))
    width = 0.25
    fig = plt.figure(figsize=(8, 5), dpi=120)
    ax = plt.gca()
    ax.bar([i - width for i in x], avg_vals, width, label="avg")
    ax.bar(x, p50_vals, width, label="p50")
    ax.bar([i + width for i in x], p90_vals, width, label="p90")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_ylabel("Latency (ms)")
    ax.set_title("Latency summary (avg / p50 / p90)")
    ax.legend()
    ax.grid(True, axis="y", linestyle="--", linewidth=0.6, alpha=0.5)
    fig.tight_layout()
    fig.savefig(outdir / "latency_summary.png")
    plt.close(fig)

def plot_success_rates(outdir: Path, R):
    agg = R.get("aggregates", {})
    ops = ["create", "verify", "revoke"]
    labels, succ_rates = [], []

    for op in ops:
        a = agg.get(op, {}) or {}
        labels.append(op)
        succ_rates.append(float(a.get("successRatePct", 0.0)))
    labels.append("tx_reliability")
    succ_rates.append(float(R.get("transactionReliabilityPct", 0.0)))

    fig = plt.figure(figsize=(8, 5), dpi=120)
    ax = plt.gca()
    ax.bar(range(len(labels)), succ_rates)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=10)
    ax.set_ylim(0, 105)
    ax.set_ylabel("Success / Reliability (%)")
    ax.set_title("Success rates per operation & overall")
    ax.grid(True, axis="y", linestyle="--", linewidth=0.6, alpha=0.5)
    fig.tight_layout()
    fig.savefig(outdir / "success_rates.png")
    plt.close(fig)

def plot_security_metrics(outdir: Path, R):
    ver_acc = float(R.get("verificationAccuracyPct", 0.0))
    dup_prev = float(R.get("duplicatePreventionPct", 0.0))
    dep_acc = float((R.get("depositRefund", {}) or {}).get("accuracyPct", 0.0))
    labels = ["verify_acc", "dup_prevent", "refund_acc"]
    vals = [ver_acc, dup_prev, dep_acc]

    fig = plt.figure(figsize=(7, 4), dpi=120)
    ax = plt.gca()
    ax.bar(range(len(labels)), vals)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, rotation=10)
    ax.set_ylim(0, 105)
    ax.set_ylabel("Percent (%)")
    ax.set_title("Security metrics")
    ax.grid(True, axis="y", linestyle="--", linewidth=0.6, alpha=0.5)
    fig.tight_layout()
    fig.savefig(outdir / "security_metrics.png")
    plt.close(fig)

def plot_verification_latency(outdir: Path, R):
    vlat = R.get("verificationLatency", {}) or {}
    ch = vlat.get("chainMs", {}) or {}
    e2e = vlat.get("endToEndMs", {}) or {}

    labels = ["avg", "p50", "p90"]
    ch_vals = [float(ch.get(k, 0.0)) for k in labels]
    e2e_vals = [float(e2e.get(k, 0.0)) for k in labels]

    x = range(len(labels))
    width = 0.35
    fig = plt.figure(figsize=(8, 5), dpi=120)
    ax = plt.gca()
    ax.bar([i - width/2 for i in x], ch_vals, width, label="chain")
    ax.bar([i + width/2 for i in x], e2e_vals, width, label="end-to-end")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels)
    ax.set_ylabel("Latency (ms)")
    ax.set_title("Verification latency (chain vs end-to-end)")
    ax.legend()
    ax.grid(True, axis="y", linestyle="--", linewidth=0.6, alpha=0.5)
    fig.tight_layout()
    fig.savefig(outdir / "verification_latency.png")
    plt.close(fig)

def plot_scalability_tps(outdir: Path, R):
    sc = R.get("scalability", [])
    if not sc:
        return
    xlabels, tps = [], []
    for s in sc:
        trials = s.get("trials", 0)
        conc = s.get("concurrency", 0)
        conf = s.get("confirmations", 0)
        label = f"{trials}\n(c={conc},k={conf})"
        xlabels.append(label)
        tps.append(float(s.get("tpsApprox", 0.0)))
    x = range(len(xlabels))
    fig = plt.figure(figsize=(9, 5), dpi=120)
    ax = plt.gca()
    ax.plot(list(x), tps, marker="o")
    ax.set_xticks(list(x))
    ax.set_xticklabels(xlabels)
    ax.set_ylabel("TPS")
    ax.set_xlabel("Scenario: trials (conc, conf)")
    ax.set_title("Scalability — TPS per scenario")
    ax.grid(True, linestyle="--", linewidth=0.6, alpha=0.5)
    fig.tight_layout()
    fig.savefig(outdir / "scalability_tps.png")
    plt.close(fig)

# ---------- main ----------
def main():
    parser = argparse.ArgumentParser(description="Plot results from bench/out/results.json")
    parser.add_argument("--in", dest="infile", default="bench/out/results.json", help="Path to results.json")
    parser.add_argument("--outdir", dest="outdir", default="bench/out", help="Directory to write plots")
    args = parser.parse_args()

    inpath = Path(args.infile)
    outdir = Path(args.outdir)
    ensure_outdir(outdir)
    if not inpath.exists():
        raise FileNotFoundError(f"Results file not found: {inpath}")

    R = load_results(inpath)
    write_summary_txt(outdir, R)

    # Generate plots
    plot_latency(outdir, R)
    plot_success_rates(outdir, R)
    plot_security_metrics(outdir, R)
    plot_verification_latency(outdir, R)
    plot_scalability_tps(outdir, R)

    print(f"✅ Plots written to: {outdir}")
    print("   - latency_summary.png")
    print("   - success_rates.png")
    print("   - security_metrics.png")
    print("   - verification_latency.png")
    if R.get('scalability'):
        print("   - scalability_tps.png")
    print("   - summary.txt")

if __name__ == "__main__":
    main()
