"""Protected, create-once host configuration. Never repairs lost keys by replacing them."""
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import stat
import time


class RuntimeConfigError(RuntimeError):
    """Safe operator-facing error: never contains a key or configuration value."""


def protected_directory(path: Path, create: bool = False) -> None:
    if create:
        try:
            path.mkdir(mode=0o700)
        except FileExistsError:
            pass
    try:
        value = path.lstat()
    except FileNotFoundError:
        raise RuntimeConfigError(f"Missing protected directory: {path.name}. Run setup or restore the installation.") from None
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != os.getuid() or stat.S_IMODE(value.st_mode) & 0o077:
        raise RuntimeConfigError(f"Unsafe protected directory: {path.name}. Require an owned real directory with mode 0700.")


def _validate_file(value: os.stat_result, name: str) -> None:
    if not stat.S_ISREG(value.st_mode) or value.st_uid != os.getuid() or value.st_nlink != 1 or stat.S_IMODE(value.st_mode) & 0o177:
        raise RuntimeConfigError(f"Unsafe protected file: {name}. Require an owned regular single-link file with mode 0600.")


def protected_read(path: Path, limit: int = 8192) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise RuntimeConfigError(f"Missing or unsafe protected file: {path.name}. Restore the original; no replacement generated.") from None
    try:
        value = os.fstat(fd)
        _validate_file(value, path.name)
        if value.st_size > limit:
            raise RuntimeConfigError(f"Invalid protected file size: {path.name}.")
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            result = stream.read(limit + 1)
        if len(result) > limit:
            raise RuntimeConfigError(f"Invalid protected file size: {path.name}.")
        return result
    finally:
        os.close(fd)


def create_file(path: Path, value: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


@contextmanager
def bootstrap_lock(runtime: Path, create: bool):
    protected_directory(runtime, create)
    try:
        fd = os.open(runtime / '.bootstrap.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    except OSError:
        raise RuntimeConfigError('Unsafe or unavailable setup lock. Check protected directory ownership.') from None
    try:
        _validate_file(os.fstat(fd), '.bootstrap.lock')
        deadline = time.monotonic() + 10
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise RuntimeConfigError('Another setup is active; retry after it finishes.') from None
                time.sleep(0.05)
        yield
    finally:
        os.close(fd)


def validate_keys(runtime: Path) -> None:
    protected_directory(runtime / 'secrets')
    if len(protected_read(runtime / 'secrets/data', 32)) != 32:
        raise RuntimeConfigError('Invalid data key. Restore the original; no replacement generated.')
    if not re.fullmatch(rb'[a-f0-9]{64}', protected_read(runtime / 'secrets/internal', 64)):
        raise RuntimeConfigError('Invalid internal key. Restore the original; no replacement generated.')


def prepare_keys(runtime: Path, may_create: bool) -> None:
    directory = runtime / 'secrets'
    if directory.is_symlink():
        raise RuntimeConfigError('Unsafe secrets directory. Symlinks are not allowed.')
    if not directory.exists():
        if not may_create:
            raise RuntimeConfigError('Missing installation keys. Restore the original protected key directory.')
        protected_directory(directory, True)
    protected_directory(directory)
    keys = [directory / 'data', directory / 'internal']
    if any(p.exists() or p.is_symlink() for p in keys):
        validate_keys(runtime)
        return
    if not may_create or any(directory.iterdir()) or (runtime / 'pg').exists() or any((runtime / 'evidence').glob('*')):
        raise RuntimeConfigError('Missing installation keys with existing state. Restore the originals; no replacement generated.')
    create_file(keys[0], secrets.token_bytes(32))
    create_file(keys[1], secrets.token_hex(32).encode())
    validate_keys(runtime)


def native_config(runtime: Path, create: bool = False) -> dict:
    with bootstrap_lock(runtime, create):
        path = runtime / 'native.json'
        exists = path.exists() or path.is_symlink()
        if not exists:
            if not create or (runtime / 'pg').exists() or (runtime / 'native-pids.json').exists():
                raise RuntimeConfigError('Missing native database configuration. Restore native.json; no replacement credentials generated.')
            # Existing Compose keys may be shared only inside this one development installation.
            prepare_keys(runtime, not (runtime / 'compose.env').exists())
            value = {key: secrets.token_hex(32) for key in ['admin', 'api', 'worker', 'engine']}
            value['socket'] = '/private/tmp/blackbox-a-' + secrets.token_hex(6)
            create_file(path, json.dumps(value).encode())
        try:
            value = json.loads(protected_read(path))
            valid = isinstance(value, dict) and set(value) == {'admin', 'api', 'worker', 'engine', 'socket'} and all(re.fullmatch('[a-f0-9]{64}', value[k]) for k in ['admin', 'api', 'worker', 'engine']) and re.fullmatch('/private/tmp/blackbox-a-[a-f0-9]{12}', value['socket'])
        except (ValueError, TypeError):
            valid = False
        if not valid:
            raise RuntimeConfigError('Invalid native database configuration. Restore native.json; no replacement credentials generated.')
        validate_keys(runtime)
        for name in ['evidence', 'logs', 'control', 'control/status', 'control/requests']:
            protected_directory(runtime / name, True)
        return value


PASSWORD_FIELDS = {'BB_DB_PASSWORD', 'BB_API_PASSWORD', 'BB_WORKER_PASSWORD', 'BB_ENGINE_PASSWORD'}


def read_compose(runtime: Path) -> dict:
    text = protected_read(runtime / 'compose.env').decode('ascii')
    values = {}
    for line in text.splitlines():
        name, separator, value = line.partition('=')
        if not separator or name in values:
            raise RuntimeConfigError('Invalid or duplicate Compose configuration field.')
        values[name] = value
    required = PASSWORD_FIELDS
    if not required <= values.keys() or not values.keys() <= required | {'BB_PROJECT', 'BB_PORT', 'BB_UID', 'BB_GID'}:
        raise RuntimeConfigError('Unexpected Compose configuration fields.')
    if not all(re.fullmatch('[a-f0-9]{64}', values[k]) for k in PASSWORD_FIELDS):
        raise RuntimeConfigError('Invalid database credential encoding; restore the protected configuration.')
    # Early developer installations used the committed Compose defaults 501:20.
    uid, gid = values.get('BB_UID', '501'), values.get('BB_GID', '20')
    if any(not re.fullmatch('[0-9]{1,10}', value) for value in [uid, gid]) or int(uid) != os.getuid() or int(gid) != os.getgid():
        raise RuntimeConfigError('Installation ownership differs from this OS user. Restore with correct ownership.')
    if not re.fullmatch('blackbox-a(?:-[a-f0-9]{12})?', values.get('BB_PROJECT', 'blackbox-a')):
        raise RuntimeConfigError('Invalid isolated Compose project name.')
    if not re.fullmatch('[0-9]{1,5}', values.get('BB_PORT', '18741')) or not 1024 <= int(values.get('BB_PORT', '18741')) <= 65535:
        raise RuntimeConfigError('Invalid loopback application port.')
    return values


def compose_config(runtime: Path, create: bool = False, port: int | None = None, require_keys: bool = True) -> dict:
    with bootstrap_lock(runtime, create):
        path = runtime / 'compose.env'
        exists = path.exists() or path.is_symlink()
        if not exists:
            if not create:
                raise RuntimeConfigError('Installation is not configured. Run explicit setup; no credentials generated on startup.')
            if any((runtime / name).exists() or (runtime / name).is_symlink() for name in ['secrets', 'native.json', 'pg', 'installation.json']) or any((runtime / 'evidence').glob('*')):
                raise RuntimeConfigError('Missing Compose configuration with existing installation state. Restore compose.env; no replacement credentials generated.')
            port = 18741 if port is None else port
            if not isinstance(port, int) or not 1024 <= port <= 65535:
                raise RuntimeConfigError('Invalid loopback application port.')
            prepare_keys(runtime, True)
            values = {'BB_UID': str(os.getuid()), 'BB_GID': str(os.getgid()), 'BB_PROJECT': 'blackbox-a-' + secrets.token_hex(6), 'BB_PORT': str(port)}
            values.update({key: secrets.token_hex(32) for key in sorted(PASSWORD_FIELDS)})
            create_file(path, ''.join(f'{key}={value}\n' for key, value in values.items()).encode())
        try:
            values = read_compose(runtime)
        except UnicodeError:
            raise RuntimeConfigError('Invalid Compose configuration encoding.') from None
        if port is not None and int(values.get('BB_PORT', '18741')) != port:
            raise RuntimeConfigError('Existing installation uses a different port. Startup never rewrites configuration.')
        if require_keys:
            validate_keys(runtime)
        for name in ['evidence', 'logs', 'control', 'control/status', 'control/requests']:
            protected_directory(runtime / name, True)
        return values
