import { describe, expect, it } from "vitest";
import {
  FEE_RATE,
  MIN_PAYOUT,
  WITHHOLDING_RATE,
  calculateFees,
  validatePayoutAmount,
} from "./fees";

/**
 * 이 파일이 지키는 것은 세 가지다.
 *
 *  1. gross = fee + withholding + net  (DB의 payouts_amount_split 제약과 같은 불변식)
 *  2. 원천징수는 gross가 아니라 "수수료를 뗀 나머지"에 걸린다 — 순서를 바꾸면 금액이 달라진다
 *  3. MIN_PAYOUT 미만은 거부된다
 *
 * 1번이 지금까지 DB에 닿아야만 확인되던 것이고, Math.floor가 두 번 들어가 있어서
 * 계산 순서를 조금만 바꿔도 깨진다.
 */

/** 경계·홀수·큰 금액을 섞은 표본. 반올림이 깨지는 자리를 노린다. */
const SAMPLES = [
  MIN_PAYOUT,
  MIN_PAYOUT + 1,
  10_001,
  10_003,
  12_345,
  33_333,
  99_999,
  100_000,
  1_000_000,
  1_234_567,
  9_999_999,
];

const TYPES = ["INDIVIDUAL", "INDIVIDUAL_BUSINESS", "CORPORATE"] as const;

describe("calculateFees", () => {
  it("gross = fee + withholding + net 이 항상 성립한다", () => {
    for (const type of TYPES) {
      for (const gross of SAMPLES) {
        const b = calculateFees(gross, type);
        expect(
          b.fee + b.withholding + b.net,
          `${type} / ${gross}원에서 합이 깨졌다`,
        ).toBe(gross);
      }
    }
  });

  it("모든 구성요소가 음수가 아닌 정수다", () => {
    for (const type of TYPES) {
      for (const gross of SAMPLES) {
        const b = calculateFees(gross, type);
        for (const [name, v] of Object.entries({
          fee: b.fee,
          withholding: b.withholding,
          net: b.net,
        })) {
          expect(Number.isInteger(v), `${type}/${gross}: ${name}가 정수가 아니다`).toBe(true);
          expect(v, `${type}/${gross}: ${name}가 음수다`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("원천징수는 gross가 아니라 수수료를 뗀 나머지에 걸린다", () => {
    // 이 순서를 뒤집으면 금액이 달라진다. 그걸 잡는 것이 이 테스트의 목적이다.
    const gross = 1_000_000;
    const { fee, withholding } = calculateFees(gross, "INDIVIDUAL");

    const taxable = gross - fee;
    expect(withholding).toBe(Math.floor(taxable * WITHHOLDING_RATE));

    // gross 전체에 걸었을 때의 값과는 반드시 달라야 한다
    expect(withholding).not.toBe(Math.floor(gross * WITHHOLDING_RATE));
    expect(withholding).toBeLessThan(Math.floor(gross * WITHHOLDING_RATE));
  });

  it("법인은 원천징수 대상이 아니다", () => {
    const gross = 1_000_000;
    const corp = calculateFees(gross, "CORPORATE");

    expect(corp.withholding).toBe(0);
    expect(corp.withholdingRate).toBe(0);
    expect(corp.net).toBe(gross - corp.fee);

    // 개인은 같은 금액에서 반드시 덜 받는다
    const indiv = calculateFees(gross, "INDIVIDUAL");
    expect(indiv.net).toBeLessThan(corp.net);
  });

  it("개인과 개인사업자는 같은 결과다", () => {
    for (const gross of SAMPLES) {
      expect(calculateFees(gross, "INDIVIDUAL_BUSINESS")).toEqual(
        calculateFees(gross, "INDIVIDUAL"),
      );
    }
  });

  it("반올림은 항상 플랫폼이 아니라 크리에이터에게 유리한 쪽으로 버린다", () => {
    // fee와 withholding 모두 floor다 → 떼어가는 쪽이 내림 → net은 손해 보지 않는다
    for (const gross of SAMPLES) {
      const b = calculateFees(gross, "INDIVIDUAL");
      expect(b.fee).toBeLessThanOrEqual(gross * FEE_RATE);
      expect(b.withholding).toBeLessThanOrEqual((gross - b.fee) * WITHHOLDING_RATE);
    }
  });

  it("gross가 커지면 net도 단조 증가한다", () => {
    // 반올림 때문에 어느 구간에서 net이 거꾸로 줄어드는 일이 없어야 한다
    let prev = -1;
    for (let gross = MIN_PAYOUT; gross <= MIN_PAYOUT + 2000; gross++) {
      const { net } = calculateFees(gross, "INDIVIDUAL");
      expect(net, `${gross}원에서 net이 감소했다`).toBeGreaterThanOrEqual(prev);
      prev = net;
    }
  });

  it("기본 수수료율은 20%, 원천징수율은 3.3%다", () => {
    // 값 자체가 바뀌는 것은 정책 변경이므로 테스트가 먼저 알려줘야 한다
    expect(FEE_RATE).toBe(0.2);
    expect(WITHHOLDING_RATE).toBe(0.033);
    expect(MIN_PAYOUT).toBe(10_000);

    // 10,000원 → 수수료 2,000 / 과세대상 8,000 / 원천징수 264 / 실수령 7,736
    expect(calculateFees(10_000, "INDIVIDUAL")).toMatchObject({
      gross: 10_000,
      fee: 2_000,
      withholding: 264,
      net: 7_736,
    });
  });
});

describe("validatePayoutAmount", () => {
  const PLENTY = 100_000_000;

  it("최소 금액 이상이고 잔액 안이면 통과한다", () => {
    expect(validatePayoutAmount(MIN_PAYOUT, PLENTY)).toBeNull();
    expect(validatePayoutAmount(MIN_PAYOUT, MIN_PAYOUT)).toBeNull();
  });

  it("최소 금액에서 1원만 모자라도 거부한다", () => {
    expect(validatePayoutAmount(MIN_PAYOUT - 1, PLENTY)).not.toBeNull();
  });

  it("잔액을 1원이라도 넘으면 거부한다", () => {
    expect(validatePayoutAmount(MIN_PAYOUT + 1, MIN_PAYOUT)).not.toBeNull();
  });

  it("0, 음수, 소수, NaN을 거부한다", () => {
    for (const bad of [0, -1, -MIN_PAYOUT, 10_000.5, NaN, Infinity]) {
      expect(validatePayoutAmount(bad, PLENTY), `${bad}이 통과했다`).not.toBeNull();
    }
  });

  it("통과한 금액은 실수령액이 반드시 0보다 크다", () => {
    for (const gross of SAMPLES) {
      if (validatePayoutAmount(gross, PLENTY) !== null) continue;
      expect(calculateFees(gross, "INDIVIDUAL").net).toBeGreaterThan(0);
    }
  });
});
