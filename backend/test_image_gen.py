"""Test Unsplash image generation across ~10 varied topics.

Run from the backend directory with the venv activated:
    cd backend && source venv/bin/activate && python test_image_gen.py

It calls the real Unsplash API, so respect the free-tier limit
(50 requests/hour). Each prompt costs 1 search + 1 image download = 2 requests.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))

import main as mainmod


TEST_PROMPTS = [
    "A cozy village kitchen with warm morning light, fresh bread cooling on a wooden counter",
    "A mountain hiking trail at sunrise with mist rising from the valley floor",
    "A busy modern office with large windows and people collaborating around a table",
    "A tropical beach at sunset with palm trees and turquoise water",
    "A classroom with students raising their hands and a smiling teacher",
    "A small bookstore with wooden shelves filled with books and cozy reading nooks",
    "A farmer's market with colorful produce and friendly vendors chatting",
    "A city skyline at night with glowing lights and reflections on the river",
    "A quiet library with sunbeams streaming through tall arched windows",
    "A family dinner table with homemade food and everyone laughing together",
]


def main() -> None:
    print("=" * 60)
    print("IMAGE GENERATION TEST")
    print(f"Topics: {len(TEST_PROMPTS)}")
    print(f"Key configured: {bool(mainmod.UNSPLASH_ACCESS_KEY)}")
    print("=" * 60)

    if not mainmod.UNSPLASH_ACCESS_KEY:
        print("SKIP: UNSPLASH_ACCESS_KEY is not set in backend/.env")
        return

    successes = 0
    failures = 0
    results = []

    for i, prompt in enumerate(TEST_PROMPTS, 1):
        print(f"\n--- Test {i}/{len(TEST_PROMPTS)} ---")
        print(f"Prompt: {prompt[:80]}...")
        try:
            data = mainmod.generate_image(prompt)
            if data:
                successes += 1
                results.append((prompt, "success", len(data)))
                print(f"OK: fetched {len(data)} bytes")
            else:
                failures += 1
                results.append((prompt, "empty", 0))
                print("FAIL: empty data returned")
        except Exception as e:
            failures += 1
            results.append((prompt, "error", str(e)[:120]))
            print(f"FAIL: {e}")
        time.sleep(1.2)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for prompt, status, detail in results:
        print(f"[{status:^7}] {prompt[:55]:<55} {detail}")
    print("-" * 60)
    print(f"Success: {successes}/{len(TEST_PROMPTS)}")
    print(f"Failed:  {failures}/{len(TEST_PROMPTS)}")
    if TEST_PROMPTS:
        print(f"Rate:    {100 * successes / len(TEST_PROMPTS):.0f}%")
    print("=" * 60)


if __name__ == "__main__":
    main()
