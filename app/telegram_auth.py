import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


def validate_init_data(
    init_data: str,
    bot_token: str,
    max_age: int = 86400
):
    if not init_data:
        raise ValueError("Missing Telegram initData")

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))

    received_hash = pairs.pop("hash", None)

    if not received_hash:
        raise ValueError("Missing hash")

    auth_date = int(pairs.get("auth_date", "0"))

    if not auth_date or time.time() - auth_date > max_age:
        raise ValueError("Expired initData")

    data_check_string = "\n".join(
        f"{key}={pairs[key]}"
        for key in sorted(pairs)
    )

    secret_key = hmac.new(
        b"WebAppData",
        bot_token.encode(),
        hashlib.sha256
    ).digest()

    calculated = hmac.new(
        secret_key,
        data_check_string.encode(),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(calculated, received_hash):
        raise ValueError("Invalid Telegram signature")

    user_raw = pairs.get("user")

    if not user_raw:
        raise ValueError("Telegram user is missing")

    return json.loads(user_raw)