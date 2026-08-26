import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


def validate_init_data(init_data: str, bot_token: str, max_age: int = 86400):
    if not init_data:
        raise ValueError('Missing Telegram initData')

    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop('hash', None)
    if not received_hash:
        raise ValueError('Invalid Telegram initData')

    data_check_string = '\n'.join(
        f'{key}={value}' for key, value in sorted(pairs.items())
    )

    secret_key = hmac.new(
        b'WebAppData',
        bot_token.encode('utf-8'),
        hashlib.sha256,
    ).digest()

    calculated_hash = hmac.new(
        secret_key,
        data_check_string.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise ValueError('Invalid Telegram initData signature')

    try:
        auth_date = int(pairs.get('auth_date', '0'))
    except ValueError:
        auth_date = 0

    if not auth_date or time.time() - auth_date > max_age:
        raise ValueError('Telegram initData is expired')

    try:
        user = json.loads(pairs.get('user', '{}'))
    except json.JSONDecodeError as exc:
        raise ValueError('Invalid Telegram user data') from exc

    if not user.get('id'):
        raise ValueError('Telegram user is missing')

    return user
