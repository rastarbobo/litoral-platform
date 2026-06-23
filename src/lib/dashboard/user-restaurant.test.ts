import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────

const mockFindFirst = vi.fn();
const mockFindMany = vi.fn();

vi.mock("@/utils/auth", () => ({
  getSessionFromCookie: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDB: () => ({
    query: {
      restaurantsTable: {
        findFirst: mockFindFirst,
        findMany: mockFindMany,
      },
    },
  }),
}));

import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";
import { getSessionFromCookie } from "@/utils/auth";

const mockedGetSession = getSessionFromCookie as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockReset();
  mockFindMany.mockReset();
});

describe("resolveRestaurantForUser", () => {
  it("returns null when session is null", async () => {
    mockedGetSession.mockResolvedValue(null);

    const result = await resolveRestaurantForUser();
    expect(result).toBeNull();
  });

  it("returns null when session has no user email", async () => {
    mockedGetSession.mockResolvedValue({
      user: { id: "user_1", email: null },
      session: {},
    });

    const result = await resolveRestaurantForUser();
    expect(result).toBeNull();
  });

  it("returns restaurant when slug heuristically matches email domain", async () => {
    mockedGetSession.mockResolvedValue({
      user: { id: "user_1", email: "marys-restaurant@example.com" },
      session: {},
    });

    const mockRestaurant = {
      id: "rest_abc123",
      slug: "marys-restaurant",
      name: "Mary's Restaurant",
    };

    // First pattern: Drizzle ORM where clause with like + or
    // Fall through to findMany when findFirst fails
    mockFindFirst.mockRejectedValue(new Error("Schema mismatch"));
    mockFindMany.mockResolvedValue([mockRestaurant]);

    const result = await resolveRestaurantForUser();
    expect(result).toEqual({
      restaurantId: "rest_abc123",
      slug: "marys-restaurant",
    });
  });

  it("matches by restaurant name containing email domain", async () => {
    mockedGetSession.mockResolvedValue({
      user: { id: "user_1", email: "joes-pizza@example.com" },
      session: {},
    });

    const mockRestaurant = {
      id: "rest_xyz789",
      slug: "joes-pizza-place",
      name: "Joe's Pizza Place",
    };

    mockFindFirst.mockRejectedValue(new Error("Schema mismatch"));
    mockFindMany.mockResolvedValue([mockRestaurant]);

    const result = await resolveRestaurantForUser();
    expect(result).toEqual({
      restaurantId: "rest_xyz789",
      slug: "joes-pizza-place",
    });
  });

  it("returns null when no restaurant matches heuristically", async () => {
    mockedGetSession.mockResolvedValue({
      user: { id: "user_1", email: "unknown@example.com" },
      session: {},
    });

    mockFindFirst.mockRejectedValue(new Error("Schema mismatch"));
    mockFindMany.mockResolvedValue([]);

    const result = await resolveRestaurantForUser();
    expect(result).toBeNull();
  });

  it("handles DB errors gracefully and returns null", async () => {
    mockedGetSession.mockResolvedValue({
      user: { id: "user_1", email: "test@example.com" },
      session: {},
    });

    mockFindFirst.mockRejectedValue(new Error("Schema mismatch"));
    mockFindMany.mockRejectedValue(new Error("DB connection failed"));

    const result = await resolveRestaurantForUser();
    expect(result).toBeNull();
  });
});