from multiprocessing import freeze_support

import uvicorn

from api.main import app


def main() -> None:
    freeze_support()
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765,
        access_log=False,
    )


if __name__ == "__main__":
    main()
