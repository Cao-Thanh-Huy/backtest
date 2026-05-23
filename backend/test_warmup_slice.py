import sys
import os
import numpy as np
import pandas as pd

# Thêm backend vào python path để import được modules
sys.path.append("/app/backend")

from workers.engines.features import generate_features

def test_dynamic_warmup():
    print("=== BẮT ĐẦU KIỂM TRA THUẬT TOÁN DÒ QUÉT DỌN SẠCH WARMUP NÂNG CAO ===")
    
    # 1. Giả lập dữ liệu thô 1000 dòng nến OHLCV
    np.random.seed(42)
    n_rows = 1000
    timestamps = pd.date_range(start="2026-01-01", periods=n_rows, freq="1min")
    close_prices = 100.0 + np.random.randn(n_rows).cumsum()
    
    df_raw = pd.DataFrame({
        "timestamp": timestamps,
        "open": close_prices - 0.5,
        "high": close_prices + 1.0,
        "low": close_prices - 1.0,
        "close": close_prices,
        "volume": np.random.randint(100, 1000, n_rows)
    })
    
    # 2. Cấu hình chỉ báo RSI chu kỳ 3 tích hợp Slope và Divergence giống hệt của người dùng
    indicators = [
        # Target Config
        {
            "name": "target_config",
            "horizon": 15,
            "task_type": "classification"
        },
        # RSI 3 có tích hợp các chỉ báo nâng cao phụ thuộc
        {
            "name": "rsi",
            "params": {
                "length": 3,
                "include_momentum_slope": True,
                "include_divergence": True
            }
        }
    ]
    
    # Lag Steps
    lags = [1, 5]
    
    print(f"Dữ liệu thô ban đầu: {len(df_raw)} dòng")
    
    # 3. Chạy Engine tính toán ở chế độ In-Memory
    print("\n--- Chạy In-Memory Feature Engine ---")
    df_features, generated_cols = generate_features(df_raw.copy(), indicators, lags)
    
    print(f"Số dòng sau khi tính toán và cắt tỉa: {len(df_features)} dòng")
    print(f"Tổng số cột đặc trưng được tạo ra: {len(generated_cols)}")
    
    # 4. Kiểm tra xem dòng đầu tiên có bất kỳ giá trị NaN/null nào không
    first_row = df_features.iloc[0]
    nan_cols = [col for col in df_features.columns if pd.isna(first_row[col])]
    
    print("\n--- Kết quả kiểm nghiệm dòng đầu tiên (Row index 0) ---")
    if len(nan_cols) == 0:
        print("✅ TUYỆT VỜI!!! Dòng đầu tiên hoàn toàn sạch sẽ, KHÔNG CÓ BẤT KỲ CỘT NÀO BỊ NULL (NaN)!")
    else:
        print(f"❌ Cảnh báo: Vẫn còn {len(nan_cols)} cột bị null ở dòng đầu tiên:")
        for col in nan_cols[:10]:
            print(f"   - {col}: {first_row[col]}")
            
    # 5. In thử 5 dòng đầu tiên của các cột nâng cao
    test_cols = [c for c in df_features.columns if "rsi_3_slope" in c or "rsi_3_bull_div" in c or "rsi_3_acceleration" in c][:8]
    if test_cols:
        print(f"\n--- Xem thử 5 dòng đầu của các cột nâng cao {test_cols} ---")
        print(df_features[test_cols].head(5))
    else:
        print("\nKhông tìm thấy cột nâng cao nào.")
    
    print("\n=== KẾT THÚC KIỂM TRA THÀNH CÔNG RỰC RỠ ===")

if __name__ == "__main__":
    test_dynamic_warmup()
