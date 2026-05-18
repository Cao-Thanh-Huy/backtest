import numpy as np
import pandas as pd
from typing import List, Tuple, Optional

class PurgedWalkForwardCV:
    """
    Purged Walk-Forward Cross Validation.
    Splits time series data while preventing data leakage from overlapping targets (e.g. Triple Barrier).
    
    Args:
        n_splits: Number of Walk-Forward steps (if train_bars/test_bars are not set).
        train_bars: Fixed size of training window in bars.
        test_bars: Fixed size of test window in bars.
        purge_bars: Number of bars to purge between train and test sets to prevent overlapping labels.
        embargo_bars: Number of bars to embargo after test set to prevent serial correlation.
    """
    def __init__(
        self,
        train_bars: int = 50000,
        test_bars: int = 10000,
        purge_bars: int = 20,
        embargo_bars: int = 5
    ):
        self.train_bars = train_bars
        self.test_bars = test_bars
        self.purge_bars = purge_bars
        self.embargo_bars = embargo_bars

    def split(self, df: pd.DataFrame) -> List[Tuple[pd.Index, pd.Index]]:
        """
        Yields (train_indices, test_indices) tuples.
        """
        n_samples = len(df)
        indices = np.arange(n_samples)
        
        splits = []
        
        # Start of the first train window
        start_idx = 0
        
        while True:
            train_end = start_idx + self.train_bars
            
            # If train window exceeds data, we stop
            if train_end >= n_samples:
                break
                
            test_start = train_end + self.purge_bars
            test_end = test_start + self.test_bars
            
            # If test window exceeds data, we can either truncate it or stop
            if test_start >= n_samples:
                break
            if test_end > n_samples:
                test_end = n_samples
                
            train_indices = indices[start_idx:train_end]
            test_indices = indices[test_start:test_end]
            
            splits.append((train_indices, test_indices))
            
            # Move the window forward by test_bars + embargo_bars
            start_idx += self.test_bars + self.embargo_bars
            
        return splits
