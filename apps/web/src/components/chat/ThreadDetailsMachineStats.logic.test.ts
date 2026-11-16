import { expect, it } from "vite-plus/test";

import { splitUsage } from "./ThreadDetailsMachineStats.logic";

it("splits a total into Onyx, model and other apps without exceeding it", () => {
  expect(splitUsage(60, 10, 30)).toEqual([10, 30, 20]);
  // Samples taken a moment apart can overshoot; the parts still add up to the total.
  expect(splitUsage(20, 15, 30)).toEqual([15, 5, 0]);
  expect(splitUsage(40, null, null)).toEqual([0, 0, 40]);
});
