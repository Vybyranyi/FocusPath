import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import type { User } from "@shared/index";
import { apiRequest, errorMessage, hasSessionCookie } from "@api/client";

export interface IAuthSlice {
    user: User | null;
    loading: boolean,
    error: string | null,
}

// No token anywhere in this slice. The session lives in httpOnly cookies the
// browser attaches on its own, which is what keeps it out of reach of any
// script — including one injected into this page.
const initialState: IAuthSlice = {
    user: null,
    loading: false,
    error: null,
}

interface UserResponse {
    user: User;
}

export const registerUser = createAsyncThunk(
    "auth/registerUser",
    async (
        userData: {
            name: string;
            surname: string;
            birthday: Date;
            gender: "male" | "female";
            email: string;
            password: string;
        },
        { rejectWithValue },
    ) => {
        try {
            return await apiRequest<UserResponse>("/auth/register", {
                method: "POST",
                body: userData,
            });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

export const loginUser = createAsyncThunk(
    "auth/loginUser",
    async (userData: { email: string; password: string }, { rejectWithValue }) => {
        try {
            return await apiRequest<UserResponse>("/auth/login", {
                method: "POST",
                body: userData,
            });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

/**
 * Asks for a reset link. The server answers the same whether or not the
 * address has an account, so there is nothing to put in the store — the page
 * says what happens next either way.
 */
export const requestPasswordReset = createAsyncThunk(
    "auth/requestPasswordReset",
    async (email: string, { rejectWithValue }) => {
        try {
            await apiRequest<null>("/auth/forgot-password", { method: "POST", body: { email } });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

/** Sets a new password from a reset link. The server signs the person in. */
export const resetPassword = createAsyncThunk(
    "auth/resetPassword",
    async ({ token, newPassword }: { token: string; newPassword: string }, { rejectWithValue }) => {
        try {
            return await apiRequest<UserResponse>("/auth/reset-password", {
                method: "POST",
                body: { token, newPassword },
            });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

/**
 * Restores the session on load. The cookies are already in the browser, so this
 * only asks who they belong to; the client renews an expired access cookie on
 * its own before this ever sees a 401.
 */
export const fetchCurrentUser = createAsyncThunk(
    "auth/fetchCurrentUser",
    async (_, { rejectWithValue }) => {
        // A visitor with no session cookie has nothing to restore, and asking
        // anyway costs a request whose only possible answer is 401 — which the
        // browser then writes to the console of every guest who opens the page.
        // Rejecting here lands in the same reducer as a refused request does,
        // so the outcome is identical minus the round trip.
        if (!hasSessionCookie()) {
            return rejectWithValue(null);
        }

        try {
            return await apiRequest<UserResponse>("/auth/me");
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

export const updateProfile = createAsyncThunk(
    "auth/updateProfile",
    async (
        data: {
            name: string;
            surname: string;
            birthday: string;
            gender: "male" | "female";
            email: string;
            avatar?: string;
            /** Required by the server only when `email` differs from the stored one. */
            currentPassword?: string;
        },
        { rejectWithValue },
    ) => {
        try {
            return await apiRequest<UserResponse>("/auth/profile", {
                method: "PATCH",
                body: data,
            });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

export const changePassword = createAsyncThunk(
    "auth/changePassword",
    async (data: { currentPassword: string; newPassword: string }, { rejectWithValue }) => {
        try {
            return await apiRequest<null>("/auth/password", {
                method: "PATCH",
                body: data,
            });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

export const deleteAccount = createAsyncThunk(
    "auth/deleteAccount",
    async (data: { password: string }, { rejectWithValue }) => {
        try {
            return await apiRequest<null>("/auth/account", {
                method: "DELETE",
                body: data,
            });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

/** Signing out has to reach the server: only it can clear an httpOnly cookie. */
export const logoutUser = createAsyncThunk(
    "auth/logoutUser",
    async (_, { rejectWithValue }) => {
        try {
            return await apiRequest<null>("/auth/logout", { method: "POST" });
        } catch (error) {
            return rejectWithValue(errorMessage(error));
        }
    },
);

const authSlice = createSlice({
    name: "auth",
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(registerUser.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(registerUser.fulfilled, (state, action) => {
                state.loading = false;
                state.user = action.payload.user;
            })
            .addCase(registerUser.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });

        // The reset page shows its own errors beside its own form; the slice's
        // `error` belongs to the login form and would appear there next.
        builder.addCase(resetPassword.fulfilled, (state, action) => {
            state.user = action.payload.user;
        });

        builder
            .addCase(loginUser.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(loginUser.fulfilled, (state, action) => {
                state.loading = false;
                state.user = action.payload.user;
            })
            .addCase(loginUser.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });

        builder
            .addCase(fetchCurrentUser.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchCurrentUser.fulfilled, (state, action) => {
                state.loading = false;
                state.user = action.payload.user;
            })
            .addCase(fetchCurrentUser.rejected, (state) => {
                state.loading = false;
                state.user = null;
                // Not an error worth showing: arriving without a session is the
                // normal state of a visitor who has not signed in.
                state.error = null;
            });

        builder
            .addCase(updateProfile.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(updateProfile.fulfilled, (state, action) => {
                state.loading = false;
                state.user = action.payload.user;
            })
            .addCase(updateProfile.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });

        builder
            .addCase(changePassword.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(changePassword.fulfilled, (state) => {
                state.loading = false;
            })
            .addCase(changePassword.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });

        builder
            .addCase(deleteAccount.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(deleteAccount.fulfilled, (state) => {
                state.loading = false;
                state.user = null;
            })
            .addCase(deleteAccount.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });

        builder
            .addCase(logoutUser.pending, (state) => {
                state.loading = true;
            })
            // Signed out locally either way: if the call failed, the cookies may
            // still be there, but keeping the user in the app would be worse.
            .addCase(logoutUser.fulfilled, (state) => {
                state.loading = false;
                state.user = null;
                state.error = null;
            })
            .addCase(logoutUser.rejected, (state) => {
                state.loading = false;
                state.user = null;
            });
    },
});

export default authSlice.reducer;
