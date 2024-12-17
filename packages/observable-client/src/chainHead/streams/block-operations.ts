import { Observable, distinctUntilChanged, map, takeWhile } from "rxjs"
import { PinnedBlocks } from "./pinned-blocks"

export const isBestOrFinalizedBlock = (
  blocks$: Observable<PinnedBlocks>,
  blockHash: string,
) =>
  blocks$.pipe(
    takeWhile((b) => b.blocks.has(blockHash)),
    distinctUntilChanged(
      (a, b) => a.finalized === b.finalized && a.best === b.best,
    ),
    map((pinned): "best" | "finalized" | null => {
      if (
        pinned.blocks.get(blockHash)!.number >
        pinned.blocks.get(pinned.best)!.number
      )
        return null

      const { number } = pinned.blocks.get(blockHash)!
      let current = pinned.blocks.get(pinned.best)!
      let isFinalized = pinned.finalized === current.hash
      while (current.number > number) {
        current = pinned.blocks.get(current.parent)!
        isFinalized = isFinalized || pinned.finalized === current.hash
      }
      if (isFinalized) return "finalized"
      return current.hash === blockHash ? "best" : null
    }),
    distinctUntilChanged(),
    takeWhile((x) => x !== "finalized", true),
  )
