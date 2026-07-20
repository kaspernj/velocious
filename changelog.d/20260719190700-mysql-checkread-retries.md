Fixed MySQL queries failing with `ER_CHECKREAD` ("Record has changed since last read") by retrying them on the existing connection, including when the driver wraps the original error.
