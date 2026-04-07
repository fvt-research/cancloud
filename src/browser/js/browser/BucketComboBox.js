import React from "react";

const BucketComboBox = ({
    id,
    name,
    value,
    onChange,
    options,
    placeholder,
    title,
    autoComplete,
    required,
    className,
    style,
    listId
}) => {
    const uniqueOptions = Array.from(new Set((options || []).filter(Boolean)));
    const resolvedListId = listId || `${id || name || "bucket"}-options`;

    return (
        <React.Fragment>
            <input
                id={id}
                name={name}
                type="text"
                list={resolvedListId}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                title={title}
                autoComplete={autoComplete}
                required={required}
                className={className}
                style={style}
            />
            <datalist id={resolvedListId}>
                {uniqueOptions.map((bucket) => (
                    <option key={bucket} value={bucket} />
                ))}
            </datalist>
        </React.Fragment>
    );
};

export default BucketComboBox;