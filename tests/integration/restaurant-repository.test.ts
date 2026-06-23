/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, test, beforeEach } from "vitest";

import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";

const db = getDB();

describe("RestaurantRepository State 6 transitions", () => {
  beforeEach(async () => {
    // Clear restaurants for clean state
    await env.NEXT_TAG_CACHE_D1.batch([
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM prospect_events"),
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM restaurants"),
    ]);

    // Clear KV
    const keys = await env.OPT_OUT_KV.list();
    await Promise.all(keys.keys.map((key) => env.OPT_OUT_KV.delete(key.name)));
  });

  test("dual-writes to D1 and KV when transitioning to State 6", async () => {
    const id = "restaurant-1";
    await db.insert(restaurantsTable).values({
      id,
      name: "Test Restaurant",
      behavioralState: 5,
    }).execute();

    const result = await restaurantRepo.transitionProspectState(id, "opt_out");
    expect(result.type).toBe("SUCCESS");

    // Verify D1
    const restaurant = await restaurantRepo.findById(id);
    expect(restaurant?.behavioralState).toBe(6);

    // Verify KV
    const kvVal = await env.OPT_OUT_KV.get(`opt_out:${id}`);
    expect(kvVal).toBeTruthy();
  });

  test("rejects transitions from State 6 (terminal state)", async () => {
    const id = "restaurant-terminal";
    await db.insert(restaurantsTable).values({
      id,
      name: "Terminal Restaurant",
      behavioralState: 6,
    }).execute();

    const result = await restaurantRepo.transitionProspectState(id, "email_open");
    expect(result.type).toBe("NO_OP");

    // Verify state hasn't changed
    const restaurant = await restaurantRepo.findById(id);
    expect(restaurant?.behavioralState).toBe(6);
  });
});

describe("RestaurantRepository State 5 transitions", () => {
  beforeEach(async () => {
    // Clear restaurants for clean state
    await env.NEXT_TAG_CACHE_D1.batch([
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM prospect_events"),
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM restaurants"),
    ]);
  });

  test("transitions to State 5 on reply event", async () => {
    const id = "restaurant-reply";
    await db.insert(restaurantsTable).values({
      id,
      name: "Reply Restaurant",
      behavioralState: 2,
    }).execute();

    const result = await restaurantRepo.transitionProspectState(id, "reply");
    expect(result.type).toBe("SUCCESS");

    // Verify D1
    const restaurant = await restaurantRepo.findById(id);
    expect(restaurant?.behavioralState).toBe(5);
  });
});

describe("RestaurantRepository Scarcity Enforcement", () => {
  beforeEach(async () => {
    await env.NEXT_TAG_CACHE_D1.batch([
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM prospect_events"),
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM restaurants"),
    ]);
  });

  test("checkScarcityAndEnroll succeeds for first SaaS in area", async () => {
    await db.insert(restaurantsTable).values({
      id: "rest-saas-1",
      name: "First SaaS",
      cuisineType: "Italian",
      locationArea: "Downtown",
      subscriptionStatus: "prospect",
    }).execute();

    const result = await restaurantRepo.checkScarcityAndEnroll(
      "rest-saas-1", "Italian", "Downtown", "saas"
    );

    expect(result.type).toBe("SUCCESS");
    const restaurant = await restaurantRepo.findById("rest-saas-1");
    expect(restaurant?.subscriptionStatus).toBe("active_saas");
  });

  test("checkScarcityAndEnroll blocks third SaaS enrollment", async () => {
    await db.insert(restaurantsTable).values([
      { id: "rest-saas-2a", name: "SaaS 1", cuisineType: "Italian", locationArea: "Downtown", subscriptionStatus: "active_saas" },
      { id: "rest-saas-2b", name: "SaaS 2", cuisineType: "Italian", locationArea: "Downtown", subscriptionStatus: "active_saas" },
    ]).execute();

    await db.insert(restaurantsTable).values({
      id: "rest-saas-2c",
      name: "SaaS 3",
      cuisineType: "Italian",
      locationArea: "Downtown",
      subscriptionStatus: "prospect",
    }).execute();

    const result = await restaurantRepo.checkScarcityAndEnroll(
      "rest-saas-2c", "Italian", "Downtown", "saas"
    );

    expect(result.type).toBe("SCARCITY_FULL");
  });

  test("checkScarcityAndEnroll allows only one Agency per area", async () => {
    await db.insert(restaurantsTable).values({
      id: "rest-agency-1",
      name: "First Agency",
      cuisineType: "Italian",
      locationArea: "Downtown",
      subscriptionStatus: "active_agency",
    }).execute();

    await db.insert(restaurantsTable).values({
      id: "rest-agency-2",
      name: "Second Agency",
      cuisineType: "Italian",
      locationArea: "Downtown",
      subscriptionStatus: "prospect",
    }).execute();

    const result = await restaurantRepo.checkScarcityAndEnroll(
      "rest-agency-2", "Italian", "Downtown", "agency"
    );

    expect(result.type).toBe("SCARCITY_FULL");
  });

  test("checkScarcityAndEnroll is idempotent — double call returns ALREADY_ENROLLED", async () => {
    await db.insert(restaurantsTable).values({
      id: "rest-idempotent",
      name: "Idempotent Test",
      cuisineType: "Italian",
      locationArea: "Downtown",
      subscriptionStatus: "prospect",
    }).execute();

    const first = await restaurantRepo.checkScarcityAndEnroll(
      "rest-idempotent", "Italian", "Downtown", "saas"
    );
    expect(first.type).toBe("SUCCESS");

    const second = await restaurantRepo.checkScarcityAndEnroll(
      "rest-idempotent", "Italian", "Downtown", "saas"
    );
    expect(second.type).toBe("ALREADY_ENROLLED");
  });

  test("getScarcityForCuisineArea returns correct counts and availability", async () => {
    await db.insert(restaurantsTable).values([
      { id: "scarce-1", name: "S1", cuisineType: "Italian", locationArea: "Downtown", subscriptionStatus: "active_saas" },
      { id: "scarce-2", name: "S2", cuisineType: "Italian", locationArea: "Downtown", subscriptionStatus: "active_agency" },
    ]).execute();

    const result = await restaurantRepo.getScarcityForCuisineArea("Italian", "Downtown");
    expect(result.saasCount).toBe(1);
    expect(result.agencyCount).toBe(1);
    expect(result.isAvailable).toBe(true); // SaaS still has 1 slot
  });
});

describe("RestaurantRepository Retargeting Triggers", () => {
  beforeEach(async () => {
    // Clear restaurants for clean state
    await env.NEXT_TAG_CACHE_D1.batch([
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM prospect_events"),
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM restaurants"),
    ]);
  });

  test("getRetargetingProspectsForSeason fetches unconverted prospects matching season", async () => {
    await db.insert(restaurantsTable).values([
      { id: "p1", name: "Target 1", peakSeasonStart: "07-01", behavioralState: 1 },
      { id: "p2", name: "Target 2", peakSeasonStart: "07-01", behavioralState: 5 },
      { id: "p3", name: "Opted Out", peakSeasonStart: "07-01", behavioralState: 6 },
      { id: "p4", name: "Wrong Season", peakSeasonStart: "08-01", behavioralState: 1 },
    ]).execute();

    const { data, error } = await restaurantRepo.getRetargetingProspectsForSeason("07-01");
    expect(error).toBeUndefined();
    expect(data).toHaveLength(2);
    expect(data.map(r => r.id).sort()).toEqual(["p1", "p2"]);
  });

  test("getRetargetingProspectsForCompetitor fetches unconverted prospects in same area/cuisine, excluding competitor", async () => {
    await db.insert(restaurantsTable).values([
      { id: "comp1", name: "Competitor", cuisineType: "Italian", locationArea: "Downtown", behavioralState: 7 }, // The competitor that signed up
      { id: "p1", name: "Target 1", cuisineType: "Italian", locationArea: "Downtown", behavioralState: 1 },
      { id: "p2", name: "Opted Out", cuisineType: "Italian", locationArea: "Downtown", behavioralState: 6 },
      { id: "p3", name: "Wrong Cuisine", cuisineType: "Mexican", locationArea: "Downtown", behavioralState: 1 },
      { id: "p4", name: "Wrong Area", cuisineType: "Italian", locationArea: "Uptown", behavioralState: 1 },
    ]).execute();

    const { data, error } = await restaurantRepo.getRetargetingProspectsForCompetitor("Italian", "Downtown", "comp1");
    expect(error).toBeUndefined();
    expect(data).toHaveLength(1);
    expect(data[0].id).toBe("p1");
  });
});
