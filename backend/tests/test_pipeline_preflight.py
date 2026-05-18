from fastapi import HTTPException

from app.api.v1.endpoints.pipelines import build_pipeline_preflight_report, validate_pipeline_preflight


def test_preflight_report_estimates_sweeps_and_lags():
    report = build_pipeline_preflight_report(
        indicators=[
            {"name": "rsi", "params": {}, "params_sweep": {"length": {"min": 6, "max": 10, "step": 2}}},
            {"name": "macd", "params": {}, "params_sweep": {}},
        ],
        lags=[1, 2],
        row_count=1_000,
    )

    assert report["base_feature_columns"] == 8
    assert report["total_feature_columns"] == 24
    assert report["estimated_bytes"] is not None


def test_preflight_rejects_oversized_request():
    indicators = [
        {"name": "rsi", "params": {}, "params_sweep": {"length": {"min": 1, "max": 50, "step": 1}}},
        {"name": "macd", "params": {}, "params_sweep": {"fast": {"min": 1, "max": 20, "step": 1}, "slow": {"min": 30, "max": 49, "step": 1}}},
    ]

    try:
        validate_pipeline_preflight(indicators, [1, 2, 3], row_count=200_000)
    except HTTPException as exc:
        assert exc.status_code == 422
        assert "server-side preflight" in str(exc.detail)
    else:
        raise AssertionError("Expected oversized request to be rejected")