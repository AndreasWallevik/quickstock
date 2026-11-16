import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { sortedFreezers } from "./freezerModel";

export default function useFreezers(householdId) {
  const [state, setState] = useState({ freezers: [], loading: true, error: "", errorCode: "" });
  useEffect(() => {
    if (!householdId) return undefined;
    return onSnapshot(
      collection(db, "households", householdId, "freezers"),
      (snapshot) => setState({
        freezers: sortedFreezers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
        loading: false, error: "", errorCode: "",
      }),
      (error) => setState({
        freezers: [], loading: false,
        error: error.message || "Could not load freezers.", errorCode: error.code || "",
      })
    );
  }, [householdId]);
  return state;
}
