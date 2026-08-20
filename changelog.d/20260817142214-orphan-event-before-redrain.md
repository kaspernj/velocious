Fix `background-job-orphaned` notifications waiting behind the orphan sweep's dispatch drain, which could prevent application recovery handlers from running while the dispatcher was stalled.
