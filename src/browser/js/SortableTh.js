import React from "react";

// Clickable column header for the device tables. `column` is
// { key, label, width?, title? } - a null key renders a plain, unsortable th.
const SortableTh = ({ column, sortBy, sortDesc, onSort, className }) => {
  const style = column.width ? { width: column.width } : undefined;
  const classes = className ? [className] : [];

  if (!column.key) {
    return (
      <th style={style} className={classes.join(" ") || undefined}>
        {column.label}
      </th>
    );
  }

  const active = sortBy === column.key;
  const icon = active ? (sortDesc ? "fa-caret-down" : "fa-caret-up") : "fa-sort";
  classes.push("table-sortable");
  if (active) classes.push("table-sorted");

  return (
    <th
      style={style}
      className={classes.join(" ")}
      title={
        (column.title ? column.title + " - " : "") + "Sort by " + column.label
      }
      onClick={() => onSort(column.key)}
    >
      {column.label}
      <i className={"fa table-sort-icon " + icon} />
    </th>
  );
};

export default SortableTh;
